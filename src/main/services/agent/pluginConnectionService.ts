import type {
  PluginMcpConnectInput, PluginMcpConnection, PluginMcpConnectionSummary, PluginMcpDisconnectInput,
  PluginMcpPluginView, PluginMcpServerDeclaration, PluginMcpServerView, PluginMcpTargetInput, PluginMetadata
} from '../../../shared/types'
import { PluginConnectionStore } from './pluginConnectionStore'
import { PluginCredentialVault } from './pluginCredentials'

interface ConnectionManagerAccess {
  connectBinding(input: {
    pluginId: string
    serverId: string
    connectionId: string
    restart: boolean
  }): Promise<unknown>
  disconnect(connectionId: string): Promise<void>
}

interface ServiceOptions {
  store: PluginConnectionStore
  vault: PluginCredentialVault
  manager: ConnectionManagerAccess
  listPlugins(): Promise<PluginMetadata[]>
  resolveDeclarations(pluginId: string): Promise<PluginMcpServerDeclaration[]>
  authorizeOAuth?: (input: {
    connectionId: string
    declaration: PluginMcpServerDeclaration
  }) => Promise<void>
  audit?: (event: {
    action: 'plugin.connection.connect' | 'plugin.connection.reauthorize' | 'plugin.connection.retry' | 'plugin.connection.disconnect'
    outcome: 'ask' | 'success' | 'failure'
    pluginId?: string
    connectionId?: string
  }) => void
}

export class PluginConnectionService {
  constructor(private readonly options: ServiceOptions) {}

  async list(): Promise<PluginMcpPluginView[]> {
    const [plugins, connections, bindings] = await Promise.all([
      this.options.listPlugins(), this.options.store.listConnections(), this.options.store.listBindings()
    ])
    const result: PluginMcpPluginView[] = []
    for (const plugin of plugins.filter((item) => item.components.includes('mcp'))) {
      let declarations: PluginMcpServerDeclaration[]
      try { declarations = await this.options.resolveDeclarations(plugin.id) }
      catch {
        result.push({ pluginId: plugin.id, pluginName: plugin.name, enabled: plugin.enabled, restricted: true, servers: [] })
        continue
      }
      const restricted = !plugin.enabled || !plugin.permissions.includes('network') || plugin.status !== 'ready'
      result.push({
        pluginId: plugin.id, pluginName: plugin.name, enabled: plugin.enabled, restricted,
        servers: declarations.map((declaration) => serverView(plugin.id, declaration, restricted, connections, bindings))
      })
    }
    return result.sort((left, right) => left.pluginId.localeCompare(right.pluginId))
  }

  async connect(input: PluginMcpConnectInput): Promise<PluginMcpPluginView[]> {
    const { plugin, declaration } = await this.target(input)
    this.assertAllowed(plugin)
    this.auditRequest('plugin.connection.connect', plugin.id, input.connectionId)
    let connection: PluginMcpConnection
    let connectionId = input.connectionId
    try {
      if (input.connectionId) {
        const existing = await this.options.store.getConnection(input.connectionId)
        if (!existing || existing.serverUrl !== declaration.url || existing.auth !== declaration.auth) {
          throw new Error('所选连接与插件服务不兼容')
        }
        connection = existing
        connectionId = existing.id
      } else {
        connection = await this.options.store.saveConnection({
          serverOrigin: new URL(declaration.url).origin, serverUrl: declaration.url,
          auth: declaration.auth, state: 'pending', ...optionalLabel(input.accountLabel)
        })
        connectionId = connection.id
        try { await this.authorize(connection.id, declaration, input.credential) }
        catch (error) {
          await this.options.store.removeConnection(connection.id)
          throw error
        }
      }
      await this.options.store.bindPlugin({ pluginId: plugin.id, serverId: declaration.id, connectionId: connection.id })
      await this.options.manager.connectBinding({
        pluginId: plugin.id, serverId: declaration.id, connectionId: connection.id, restart: false
      })
      this.auditResult('plugin.connection.connect', 'success', plugin.id, connection.id)
      return this.list()
    } catch (error) {
      this.auditResult('plugin.connection.connect', 'failure', plugin.id, connectionId)
      throw error
    }
  }

  async reauthorize(input: PluginMcpConnectInput): Promise<PluginMcpPluginView[]> {
    const { plugin, declaration } = await this.target(input)
    this.assertAllowed(plugin)
    const binding = await this.options.store.findBinding(plugin.id, declaration.id)
    if (!binding) throw new Error('插件服务尚未连接')
    this.auditRequest('plugin.connection.reauthorize', plugin.id, binding.connectionId)
    try {
      await this.authorize(binding.connectionId, declaration, input.credential)
      await this.options.manager.connectBinding({
        pluginId: plugin.id, serverId: declaration.id, connectionId: binding.connectionId, restart: true
      })
      this.auditResult('plugin.connection.reauthorize', 'success', plugin.id, binding.connectionId)
      return this.list()
    } catch (error) {
      this.auditResult('plugin.connection.reauthorize', 'failure', plugin.id, binding.connectionId)
      throw error
    }
  }

  async retry(input: PluginMcpTargetInput): Promise<PluginMcpPluginView[]> {
    const { plugin, declaration } = await this.target(input)
    this.assertAllowed(plugin)
    const binding = await this.options.store.findBinding(plugin.id, declaration.id)
    if (!binding) throw new Error('插件服务尚未连接')
    this.auditRequest('plugin.connection.retry', plugin.id, binding.connectionId)
    try {
      await this.options.manager.connectBinding({
        pluginId: plugin.id, serverId: declaration.id, connectionId: binding.connectionId, restart: true
      })
      this.auditResult('plugin.connection.retry', 'success', plugin.id, binding.connectionId)
      return this.list()
    } catch (error) {
      this.auditResult('plugin.connection.retry', 'failure', plugin.id, binding.connectionId)
      throw error
    }
  }

  async disconnect(input: PluginMcpDisconnectInput): Promise<PluginMcpPluginView[]> {
    const connection = await this.options.store.getConnection(input.connectionId)
    if (!connection) throw new Error('MCP 连接不存在')
    const pluginId = (await this.options.store.listBindings()).find((item) => item.connectionId === connection.id)?.pluginId
    this.auditRequest('plugin.connection.disconnect', pluginId, connection.id)
    try {
      await this.options.manager.disconnect(connection.id)
      this.auditResult('plugin.connection.disconnect', 'success', pluginId, connection.id)
      return this.list()
    } catch (error) {
      this.auditResult('plugin.connection.disconnect', 'failure', pluginId, connection.id)
      throw error
    }
  }

  private async target(input: PluginMcpTargetInput): Promise<{
    plugin: PluginMetadata
    declaration: PluginMcpServerDeclaration
  }> {
    if (!validPluginId(input.pluginId) || !validServerId(input.serverId)) throw new Error('MCP 连接参数无效')
    const plugin = (await this.options.listPlugins()).find((item) => item.id === input.pluginId)
    if (!plugin || !plugin.components.includes('mcp')) throw new Error('插件未声明 MCP 服务')
    const declaration = (await this.options.resolveDeclarations(plugin.id)).find((item) => item.id === input.serverId)
    if (!declaration) throw new Error('插件 MCP 服务不存在')
    return { plugin, declaration }
  }

  private assertAllowed(plugin: PluginMetadata): void {
    if (!plugin.enabled || plugin.status !== 'ready' || !plugin.permissions.includes('network')) {
      throw new Error('插件未启用或缺少联网权限')
    }
  }

  private async authorize(
    connectionId: string,
    declaration: PluginMcpServerDeclaration,
    credential?: string
  ): Promise<void> {
    if (declaration.auth === 'none') return
    if (declaration.auth === 'api-key') {
      if (typeof credential !== 'string' || !credential.trim()) throw new Error('请输入 API Key')
      await this.options.vault.set(connectionId, 'api-key', credential)
      return
    }
    if (!this.options.authorizeOAuth) throw new Error('OAuth 授权当前不可用')
    await this.options.authorizeOAuth({ connectionId, declaration })
  }

  private auditRequest(
    action: Parameters<NonNullable<ServiceOptions['audit']>>[0]['action'],
    pluginId?: string,
    connectionId?: string
  ): void {
    this.options.audit?.({ action, outcome: 'ask', pluginId, connectionId })
  }

  private auditResult(
    action: Parameters<NonNullable<ServiceOptions['audit']>>[0]['action'],
    outcome: 'success' | 'failure',
    pluginId?: string,
    connectionId?: string
  ): void {
    try { this.options.audit?.({ action, outcome, pluginId, connectionId }) }
    catch { /* preserve the completed operation or its original failure */ }
  }
}

function serverView(
  pluginId: string,
  declaration: PluginMcpServerDeclaration,
  restricted: boolean,
  connections: PluginMcpConnection[],
  bindings: Array<{ pluginId: string; serverId: string; connectionId: string }>
): PluginMcpServerView {
  const binding = bindings.find((item) => item.pluginId === pluginId && item.serverId === declaration.id)
  const bound = binding ? connections.find((item) => item.id === binding.connectionId) : undefined
  const compatibleConnections = connections
    .filter((item) => item.serverUrl === declaration.url && item.auth === declaration.auth)
    .map(summary)
  return {
    id: declaration.id,
    serverOrigin: new URL(declaration.url).origin,
    auth: declaration.auth,
    state: restricted ? 'restricted' : bound?.state ?? 'pending',
    ...(bound ? {
      connectionId: bound.id,
      ...(bound.accountLabel === undefined ? {} : { accountLabel: bound.accountLabel }),
      ...(bound.lastConnectedAt === undefined ? {} : { lastConnectedAt: bound.lastConnectedAt }),
      ...(bound.errorCode === undefined ? {} : { errorCode: bound.errorCode })
    } : {}),
    compatibleConnections
  }
}

function summary(connection: PluginMcpConnection): PluginMcpConnectionSummary {
  return {
    id: connection.id, serverOrigin: connection.serverOrigin, auth: connection.auth, state: connection.state,
    ...(connection.accountLabel === undefined ? {} : { accountLabel: connection.accountLabel }),
    ...(connection.lastConnectedAt === undefined ? {} : { lastConnectedAt: connection.lastConnectedAt }),
    ...(connection.errorCode === undefined ? {} : { errorCode: connection.errorCode })
  }
}

function optionalLabel(value: string | undefined): { accountLabel?: string } {
  const label = value?.trim()
  if (!label) return {}
  if (label.length > 100 || /[\u0000-\u001f]/.test(label)) throw new Error('账号标签无效')
  return { accountLabel: label }
}

function validPluginId(value: string): boolean { return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(value) }
function validServerId(value: string): boolean { return /^[a-z][a-z0-9._-]{0,63}$/.test(value) }
