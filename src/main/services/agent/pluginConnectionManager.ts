import { randomUUID } from 'node:crypto'
import type { PluginMcpServerDeclaration } from '../../../shared/types'
import { PluginConnectionStore } from './pluginConnectionStore'
import {
  createPluginMcpClient, PluginMcpError, type PluginMcpClient, type PluginMcpTool
} from './pluginMcpClient'
import type { PluginCredentialKind } from './pluginCredentials'

interface CredentialAccess {
  get(connectionId: string, kind: PluginCredentialKind): Promise<string | undefined>
  deleteConnection(connectionId: string): Promise<void>
}

export type PluginMcpClientFactory = (
  declaration: PluginMcpServerDeclaration,
  connectionId: string,
  getCredential: () => Promise<string | undefined>
) => PluginMcpClient

interface ManagerOptions {
  store: PluginConnectionStore
  vault?: CredentialAccess
  resolveDeclaration(pluginId: string, serverId: string): Promise<PluginMcpServerDeclaration | undefined>
  createClient?: PluginMcpClientFactory
  leaseTtlMs?: number
  now?: () => number
}

interface ClientEntry {
  client: PluginMcpClient
  controller: AbortController
}

interface LeaseRecord {
  id: string
  pluginId: string
  serverId: string
  connectionId: string
  taskId: string
  expiresAt: number
  active: boolean
}

export interface PluginMcpLease {
  listTools(signal: AbortSignal): Promise<PluginMcpTool[]>
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
  release(): Promise<void>
}

export interface PluginMcpToolSnapshot {
  serverId: string
  connectionId: string
  serverOrigin: string
  accountLabel?: string
  tools: PluginMcpTool[]
}

export class PluginConnectionManager {
  private readonly clients = new Map<string, ClientEntry>()
  private readonly connecting = new Map<string, Promise<ClientEntry>>()
  private readonly leases = new Map<string, LeaseRecord>()
  private readonly now: () => number
  private readonly leaseTtlMs: number

  constructor(private readonly options: ManagerOptions) {
    this.now = options.now ?? Date.now
    this.leaseTtlMs = options.leaseTtlMs ?? 15 * 60_000
  }

  async snapshotPluginTools(pluginId: string): Promise<PluginMcpToolSnapshot[]> {
    const bindings = (await this.options.store.listBindings())
      .filter((binding) => binding.pluginId === pluginId)
      .sort((left, right) => left.serverId.localeCompare(right.serverId))
    const snapshots: PluginMcpToolSnapshot[] = []
    for (const binding of bindings) {
      const connection = await this.options.store.getConnection(binding.connectionId)
      if (!connection || connection.state !== 'connected') continue
      try {
        const declaration = await this.options.resolveDeclaration(pluginId, binding.serverId)
        if (!declaration || new URL(declaration.url).toString() !== connection.serverUrl || declaration.auth !== connection.auth) continue
        const entry = await this.getOrConnect(connection.id, declaration)
        const tools = await entry.client.listTools(entry.controller.signal)
        snapshots.push({
          serverId: binding.serverId,
          connectionId: connection.id,
          serverOrigin: connection.serverOrigin,
          ...(connection.accountLabel === undefined ? {} : { accountLabel: connection.accountLabel }),
          tools: structuredClone(tools)
        })
      } catch (error) {
        if (error instanceof PluginMcpError && this.clients.has(connection.id)) {
          await this.invalidateConnection(connection.id, error)
        }
        // One unavailable external service must not suppress healthy task tools.
      }
    }
    return snapshots
  }

  async acquireLease(input: {
    pluginId: string
    serverId: string
    connectionId: string
    taskId: string
  }): Promise<PluginMcpLease> {
    if (!validTaskId(input.taskId)) throw new Error('MCP 任务标识无效')
    const binding = await this.options.store.findBinding(input.pluginId, input.serverId)
    if (!binding || binding.connectionId !== input.connectionId) throw new Error('MCP 连接未显式绑定到此插件')
    const connection = await this.options.store.getConnection(input.connectionId)
    if (!connection) throw new Error('MCP 连接不存在')
    const declaration = await this.options.resolveDeclaration(input.pluginId, input.serverId)
    if (!declaration || new URL(declaration.url).toString() !== connection.serverUrl || declaration.auth !== connection.auth) {
      throw new Error('MCP 声明与连接不匹配')
    }
    await this.getOrConnect(input.connectionId, declaration)
    const record: LeaseRecord = {
      id: randomUUID(), ...input, expiresAt: this.now() + this.leaseTtlMs, active: true
    }
    this.leases.set(record.id, record)
    return {
      listTools: (signal) => this.withLease(record, signal, (client, combined) => client.listTools(combined)),
      callTool: (name, args, signal) => this.withLease(record, signal, (client, combined) => client.callTool(name, args, combined)),
      release: async () => { this.revokeLease(record) }
    }
  }

  async releaseTask(taskId: string): Promise<void> {
    for (const lease of this.leases.values()) if (lease.taskId === taskId) this.revokeLease(lease)
  }

  async disconnect(connectionId: string): Promise<void> {
    for (const lease of this.leases.values()) if (lease.connectionId === connectionId) this.revokeLease(lease)
    const entry = this.clients.get(connectionId)
    if (entry) {
      entry.controller.abort()
      this.clients.delete(connectionId)
      await entry.client.close()
    }
    await this.options.vault?.deleteConnection(connectionId)
    await this.options.store.removeConnection(connectionId)
  }

  async close(): Promise<void> {
    for (const lease of this.leases.values()) this.revokeLease(lease)
    const entries = [...this.clients.values()]
    this.clients.clear()
    for (const entry of entries) { entry.controller.abort(); await entry.client.close() }
  }

  private async getOrConnect(connectionId: string, declaration: PluginMcpServerDeclaration): Promise<ClientEntry> {
    const current = this.clients.get(connectionId)
    if (current) return current
    const pending = this.connecting.get(connectionId)
    if (pending) return pending
    const created = (async () => {
      const getCredential = async (): Promise<string | undefined> => {
        if (declaration.auth === 'none') return undefined
        const kind: PluginCredentialKind = declaration.auth === 'api-key' ? 'api-key' : 'access-token'
        return this.options.vault?.get(connectionId, kind)
      }
      const client = this.options.createClient?.(declaration, connectionId, getCredential) ??
        createPluginMcpClient(declaration, { getCredential })
      const entry = { client, controller: new AbortController() }
      try {
        await client.connect(entry.controller.signal)
        this.clients.set(connectionId, entry)
        await this.options.store.updateConnection(connectionId, {
          state: 'connected', lastConnectedAt: this.now(), errorCode: undefined
        })
        return entry
      } catch (error) {
        entry.controller.abort()
        await client.close()
        await this.setFailureState(connectionId, error)
        throw error
      } finally { this.connecting.delete(connectionId) }
    })()
    this.connecting.set(connectionId, created)
    return created
  }

  private async withLease<T>(
    lease: LeaseRecord,
    signal: AbortSignal,
    action: (client: PluginMcpClient, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (!lease.active || this.leases.get(lease.id) !== lease || this.now() >= lease.expiresAt) {
      this.revokeLease(lease)
      throw new Error('MCP 租约已失效')
    }
    const entry = this.clients.get(lease.connectionId)
    if (!entry) { this.revokeLease(lease); throw new Error('MCP 租约对应的连接已关闭') }
    try {
      return await action(entry.client, AbortSignal.any([signal, entry.controller.signal]))
    } catch (error) {
      if (error instanceof PluginMcpError && error.code !== 'MCP_ABORTED') await this.invalidateConnection(lease.connectionId, error)
      throw error
    }
  }

  private async invalidateConnection(connectionId: string, error: unknown): Promise<void> {
    for (const lease of this.leases.values()) if (lease.connectionId === connectionId) this.revokeLease(lease)
    const entry = this.clients.get(connectionId)
    if (entry) {
      this.clients.delete(connectionId)
      entry.controller.abort()
      await entry.client.close()
    }
    await this.setFailureState(connectionId, error)
  }

  private async setFailureState(connectionId: string, error: unknown): Promise<void> {
    const code = error instanceof PluginMcpError ? error.code : 'MCP_CONNECT_FAILED'
    const state = code === 'MCP_UNAUTHORIZED' ? 'pending' : code === 'MCP_FORBIDDEN' ? 'restricted' : 'failed'
    await this.options.store.updateConnection(connectionId, { state, errorCode: code })
  }

  private revokeLease(lease: LeaseRecord): void {
    lease.active = false
    this.leases.delete(lease.id)
  }
}

function validTaskId(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && !/[\u0000-\u001f]/.test(value)
}
