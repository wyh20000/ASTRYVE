import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  PluginMcpBinding, PluginMcpConnection, PluginMcpConnectionState
} from '../../../shared/types'

const FILE = 'plugin-connections.json'
const MAX_FILE_BYTES = 256 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/
const SERVER_ID = /^[a-z][a-z0-9._-]{0,63}$/
const queues = new Map<string, Promise<unknown>>()

interface PersistedConnections {
  connections: PluginMcpConnection[]
  bindings: PluginMcpBinding[]
}

export class PluginConnectionStore {
  constructor(private readonly dataRoot: string) {}

  async listConnections(): Promise<PluginMcpConnection[]> {
    return (await readState(this.dataRoot)).connections.map((item) => ({ ...item }))
  }

  async listBindings(): Promise<PluginMcpBinding[]> {
    return (await readState(this.dataRoot)).bindings.map((item) => ({ ...item }))
  }

  async getConnection(id: string): Promise<PluginMcpConnection | undefined> {
    return (await this.listConnections()).find((item) => item.id === id)
  }

  async findBinding(pluginId: string, serverId: string): Promise<PluginMcpBinding | undefined> {
    return (await this.listBindings()).find((item) => item.pluginId === pluginId && item.serverId === serverId)
  }

  saveConnection(input: Omit<PluginMcpConnection, 'id'>): Promise<PluginMcpConnection> {
    return mutate(this.dataRoot, async (state) => {
      const connection = parseConnection({ ...input, id: randomUUID() })
      if (!connection) throw new Error('MCP 连接元数据无效')
      state.connections.push(connection)
      sortState(state)
      return connection
    })
  }

  updateConnection(
    id: string,
    patch: Partial<Pick<PluginMcpConnection, 'state' | 'accountLabel' | 'lastConnectedAt' | 'errorCode'>>
  ): Promise<PluginMcpConnection> {
    return mutate(this.dataRoot, async (state) => {
      const index = state.connections.findIndex((item) => item.id === id)
      if (index < 0) throw new Error('MCP 连接不存在')
      const connection = parseConnection({ ...state.connections[index], ...patch })
      if (!connection) throw new Error('MCP 连接状态无效')
      state.connections[index] = connection
      return connection
    })
  }

  bindPlugin(binding: PluginMcpBinding): Promise<PluginMcpBinding> {
    return mutate(this.dataRoot, async (state) => {
      const parsed = parseBinding(binding)
      if (!parsed || !state.connections.some((item) => item.id === parsed.connectionId)) throw new Error('MCP 插件绑定无效')
      state.bindings = state.bindings.filter((item) =>
        item.pluginId !== parsed.pluginId || item.serverId !== parsed.serverId)
      state.bindings.push(parsed)
      sortState(state)
      return parsed
    })
  }

  unbindPlugin(pluginId: string, serverId?: string): Promise<number> {
    return mutate(this.dataRoot, async (state) => {
      if (!PLUGIN_ID.test(pluginId) || (serverId !== undefined && !SERVER_ID.test(serverId))) throw new Error('MCP 插件绑定无效')
      const before = state.bindings.length
      state.bindings = state.bindings.filter((item) => item.pluginId !== pluginId || (serverId !== undefined && item.serverId !== serverId))
      return before - state.bindings.length
    })
  }

  removeConnection(id: string): Promise<boolean> {
    return mutate(this.dataRoot, async (state) => {
      if (!UUID.test(id)) throw new Error('MCP 连接标识无效')
      const before = state.connections.length
      state.connections = state.connections.filter((item) => item.id !== id)
      state.bindings = state.bindings.filter((item) => item.connectionId !== id)
      return state.connections.length !== before
    })
  }
}

async function readState(dataRoot: string): Promise<PersistedConnections> {
  try {
    const path = join(dataRoot, FILE)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) return empty()
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.connections) ||
        !Array.isArray(value.bindings) || value.connections.length > 100 || value.bindings.length > 500) return empty()
    const connections = value.connections.map(parseConnection)
    const bindings = value.bindings.map(parseBinding)
    if (connections.some((item) => !item) || bindings.some((item) => !item)) return empty()
    const parsed = { connections: connections as PluginMcpConnection[], bindings: bindings as PluginMcpBinding[] }
    const ids = new Set(parsed.connections.map((item) => item.id))
    if (ids.size !== parsed.connections.length || parsed.bindings.some((item) => !ids.has(item.connectionId))) return empty()
    const bindingKeys = new Set(parsed.bindings.map((item) => `${item.pluginId}\0${item.serverId}`))
    if (bindingKeys.size !== parsed.bindings.length) return empty()
    sortState(parsed)
    return parsed
  } catch { return empty() }
}

function parseConnection(value: unknown): PluginMcpConnection | undefined {
  if (!record(value) || typeof value.id !== 'string' || !UUID.test(value.id) ||
      typeof value.serverOrigin !== 'string' || typeof value.serverUrl !== 'string' ||
      !['none', 'api-key', 'oauth2'].includes(String(value.auth)) ||
      !['pending', 'connected', 'failed', 'restricted'].includes(String(value.state))) return undefined
  let url: URL
  try { url = new URL(value.serverUrl) } catch { return undefined }
  if (url.protocol !== 'https:' || url.origin !== value.serverOrigin || url.username || url.password || url.hash) return undefined
  const accountLabel = optionalText(value.accountLabel, 100)
  const errorCode = optionalCode(value.errorCode)
  const lastConnectedAt = optionalTimestamp(value.lastConnectedAt)
  if (accountLabel === null || errorCode === null || lastConnectedAt === null) return undefined
  return {
    id: value.id, serverOrigin: value.serverOrigin, serverUrl: url.toString(),
    auth: value.auth as PluginMcpConnection['auth'], state: value.state as PluginMcpConnectionState,
    ...(accountLabel === undefined ? {} : { accountLabel }),
    ...(lastConnectedAt === undefined ? {} : { lastConnectedAt }),
    ...(errorCode === undefined ? {} : { errorCode })
  }
}

function parseBinding(value: unknown): PluginMcpBinding | undefined {
  if (!record(value) || typeof value.pluginId !== 'string' || !PLUGIN_ID.test(value.pluginId) ||
      typeof value.serverId !== 'string' || !SERVER_ID.test(value.serverId) ||
      typeof value.connectionId !== 'string' || !UUID.test(value.connectionId)) return undefined
  return { pluginId: value.pluginId, serverId: value.serverId, connectionId: value.connectionId }
}

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) return null
  return value.trim()
}

function optionalCode(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : null
}

function optionalTimestamp(value: unknown): number | undefined | null {
  if (value === undefined) return undefined
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function mutate<T>(dataRoot: string, action: (state: PersistedConnections) => Promise<T>): Promise<T> {
  const previous = queues.get(dataRoot) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(async () => {
    const state = await readState(dataRoot)
    const result = await action(state)
    await writeState(dataRoot, state)
    return result
  })
  queues.set(dataRoot, current)
  void current.finally(() => { if (queues.get(dataRoot) === current) queues.delete(dataRoot) }).catch(() => undefined)
  return current
}

async function writeState(dataRoot: string, state: PersistedConnections): Promise<void> {
  await mkdir(dataRoot, { recursive: true })
  const path = join(dataRoot, FILE)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ schemaVersion: 1, ...state }), { flag: 'wx', mode: 0o600 })
  try { await rename(temporary, path) } finally { await rm(temporary, { force: true }).catch(() => undefined) }
}

function sortState(state: PersistedConnections): void {
  state.connections.sort((left, right) => left.id.localeCompare(right.id))
  state.bindings.sort((left, right) => `${left.pluginId}\0${left.serverId}`.localeCompare(`${right.pluginId}\0${right.serverId}`))
}

function empty(): PersistedConnections { return { connections: [], bindings: [] } }
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
