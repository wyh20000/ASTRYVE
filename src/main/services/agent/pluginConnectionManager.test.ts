import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PluginMcpServerDeclaration } from '../../../shared/types'
import { PluginConnectionStore } from './pluginConnectionStore'
import { PluginConnectionManager } from './pluginConnectionManager'
import { PluginMcpError, type PluginMcpClient } from './pluginMcpClient'

const declaration: PluginMcpServerDeclaration = {
  id: 'api', url: 'https://api.example.com/mcp', transport: 'streamable-http', auth: 'none'
}

function fakeClient(call: () => Promise<unknown> = async () => ({ content: [] })): PluginMcpClient {
  return {
    connect: vi.fn(async () => undefined),
    listTools: vi.fn(async () => [{ name: 'ping', inputSchema: { type: 'object', additionalProperties: false } }]),
    callTool: vi.fn(call), close: vi.fn(async () => undefined)
  }
}

describe('plugin connection manager', () => {
  it('snapshots tools only from exact connected bindings and skips pending connections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-manager-snapshot-'))
    const store = new PluginConnectionStore(root)
    const connected = await store.saveConnection({ serverOrigin: 'https://api.example.com', serverUrl: declaration.url, auth: 'none', state: 'connected', accountLabel: 'a***@example.com' })
    const pending = await store.saveConnection({ serverOrigin: 'https://api.example.com', serverUrl: declaration.url, auth: 'none', state: 'pending' })
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'api', connectionId: connected.id })
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'pending', connectionId: pending.id })
    const manager = new PluginConnectionManager({
      store,
      resolveDeclaration: async (_pluginId, serverId) => serverId === 'api' ? declaration : { ...declaration, id: 'pending' },
      createClient: () => fakeClient()
    })

    await expect(manager.snapshotPluginTools('one.plugin')).resolves.toEqual([{
      serverId: 'api', connectionId: connected.id, serverOrigin: 'https://api.example.com',
      accountLabel: 'a***@example.com',
      tools: [{ name: 'ping', inputSchema: { type: 'object', additionalProperties: false } }]
    }])
  })

  it('isolates snapshot discovery failures and retains healthy connections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-manager-snapshot-failure-'))
    const store = new PluginConnectionStore(root)
    const failed = await store.saveConnection({ serverOrigin: 'https://api.example.com', serverUrl: declaration.url, auth: 'none', state: 'connected' })
    const healthy = await store.saveConnection({ serverOrigin: 'https://api.example.com', serverUrl: declaration.url, auth: 'none', state: 'connected' })
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'broken', connectionId: failed.id })
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'healthy', connectionId: healthy.id })
    const brokenClient = fakeClient()
    brokenClient.listTools = async () => { throw new PluginMcpError('MCP_TOOLS_INVALID', 'broken catalog') }
    const healthyClient = fakeClient()
    const isolated = new PluginConnectionManager({
      store,
      resolveDeclaration: async (_pluginId, serverId) => ({ ...declaration, id: serverId }),
      createClient: (_declaration, id) => id === failed.id ? brokenClient : healthyClient
    })

    const snapshots = await isolated.snapshotPluginTools('one.plugin')
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].serverId).toBe('healthy')
    expect((await store.getConnection(failed.id))?.state).toBe('failed')
    expect((await store.getConnection(healthy.id))?.state).toBe('connected')
    await isolated.close()
  })

  it('requires an exact explicit plugin/server binding before creating a task lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-manager-binding-'))
    const store = new PluginConnectionStore(root)
    const connection = await store.saveConnection({
      serverOrigin: 'https://api.example.com', serverUrl: declaration.url, auth: 'none', state: 'pending'
    })
    const manager = new PluginConnectionManager({
      store, resolveDeclaration: async () => declaration, createClient: () => fakeClient()
    })
    await expect(manager.acquireLease({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id, taskId: 'task-1' }))
      .rejects.toThrow('绑定')
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id })
    const lease = await manager.acquireLease({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id, taskId: 'task-1' })
    await expect(lease.listTools(new AbortController().signal)).resolves.toHaveLength(1)
    expect((await store.getConnection(connection.id))?.state).toBe('connected')
  })

  it('isolates a failed connection while another lease remains usable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-manager-isolation-'))
    const store = new PluginConnectionStore(root)
    const one = await store.saveConnection({ serverOrigin: 'https://api.example.com', serverUrl: declaration.url, auth: 'none', state: 'pending' })
    const two = await store.saveConnection({ serverOrigin: 'https://api.example.com', serverUrl: declaration.url, auth: 'none', state: 'pending' })
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'api', connectionId: one.id })
    await store.bindPlugin({ pluginId: 'two.plugin', serverId: 'api', connectionId: two.id })
    const clients = new Map<string, PluginMcpClient>([
      [one.id, fakeClient(async () => { throw new PluginMcpError('MCP_CALL_FAILED', 'broken') })],
      [two.id, fakeClient(async () => ({ content: [{ type: 'text', text: 'pong' }] }))]
    ])
    const manager = new PluginConnectionManager({
      store, resolveDeclaration: async () => declaration, createClient: (_declaration, id) => clients.get(id)!
    })
    const failed = await manager.acquireLease({ pluginId: 'one.plugin', serverId: 'api', connectionId: one.id, taskId: 'task-1' })
    const healthy = await manager.acquireLease({ pluginId: 'two.plugin', serverId: 'api', connectionId: two.id, taskId: 'task-1' })
    await expect(failed.callTool('broken', {}, new AbortController().signal)).rejects.toMatchObject({ code: 'MCP_CALL_FAILED' })
    await expect(healthy.callTool('ping', {}, new AbortController().signal)).resolves.toBeDefined()
    expect((await store.getConnection(one.id))?.state).toBe('failed')
    expect((await store.getConnection(two.id))?.state).toBe('connected')
  })

  it('revokes task leases and deletes credentials plus bindings on explicit disconnect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-manager-disconnect-'))
    const store = new PluginConnectionStore(root)
    const connection = await store.saveConnection({ serverOrigin: 'https://api.example.com', serverUrl: declaration.url, auth: 'none', state: 'pending' })
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id })
    const client = fakeClient()
    const deleteConnection = vi.fn(async () => undefined)
    const manager = new PluginConnectionManager({
      store, vault: { get: async () => undefined, deleteConnection },
      resolveDeclaration: async () => declaration, createClient: () => client
    })
    const lease = await manager.acquireLease({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id, taskId: 'task-1' })
    await manager.releaseTask('task-1')
    await expect(lease.listTools(new AbortController().signal)).rejects.toThrow('租约')
    const second = await manager.acquireLease({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id, taskId: 'task-2' })
    await manager.disconnect(connection.id)
    await expect(second.listTools(new AbortController().signal)).rejects.toThrow('租约')
    expect(deleteConnection).toHaveBeenCalledWith(connection.id)
    expect(await store.getConnection(connection.id)).toBeUndefined()
    expect(await store.listBindings()).toEqual([])
    expect(client.close).toHaveBeenCalled()
  })

  it('revokes existing task leases when a connection is retried or reauthorized', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-manager-restart-'))
    const store = new PluginConnectionStore(root)
    const connection = await store.saveConnection({
      serverOrigin: 'https://api.example.com', serverUrl: declaration.url, auth: 'none', state: 'connected'
    })
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id })
    const clients = [fakeClient(), fakeClient()]
    let next = 0
    const manager = new PluginConnectionManager({
      store, resolveDeclaration: async () => declaration, createClient: () => clients[next++]
    })
    const oldLease = await manager.acquireLease({
      pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id, taskId: 'old-task'
    })

    await manager.connectBinding({
      pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id, restart: true
    })

    await expect(oldLease.listTools(new AbortController().signal)).rejects.toThrow('租约')
    expect(clients[0].close).toHaveBeenCalled()
    expect(clients[1].connect).toHaveBeenCalled()
  })

  it('aborts an in-flight connection and prevents it from reviving after manager close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-manager-close-race-'))
    const store = new PluginConnectionStore(root)
    const connection = await store.saveConnection({
      serverOrigin: 'https://api.example.com', serverUrl: declaration.url, auth: 'none', state: 'pending'
    })
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id })
    let release!: () => void
    let signal: AbortSignal | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const client = fakeClient()
    client.connect = vi.fn(async (value) => { signal = value; await gate })
    const manager = new PluginConnectionManager({
      store, resolveDeclaration: async () => declaration, createClient: () => client
    })

    const acquiring = manager.acquireLease({
      pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id, taskId: 'task-1'
    })
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalledOnce())
    const closing = manager.close()
    expect(signal?.aborted).toBe(true)
    release()

    await expect(acquiring).rejects.toThrow()
    await closing
    expect(client.close).toHaveBeenCalled()
    await expect(manager.acquireLease({
      pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id, taskId: 'task-2'
    })).rejects.toThrow('已关闭')
  })
})
