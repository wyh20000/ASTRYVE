import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PluginConnectionStore } from './pluginConnectionStore'

const input = {
  serverOrigin: 'https://api.example.com', serverUrl: 'https://api.example.com/mcp',
  auth: 'oauth2' as const, state: 'pending' as const
}

describe('plugin connection store', () => {
  it('requires explicit bindings and preserves a shared host connection when one plugin unbinds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-connections-'))
    const store = new PluginConnectionStore(root)
    const connection = await store.saveConnection(input)
    expect(await store.listBindings()).toEqual([])

    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id })
    await store.bindPlugin({ pluginId: 'two.plugin', serverId: 'api', connectionId: connection.id })
    await store.unbindPlugin('one.plugin')

    expect(await store.listConnections()).toEqual([connection])
    expect(await store.listBindings()).toEqual([{
      pluginId: 'two.plugin', serverId: 'api', connectionId: connection.id
    }])
  })

  it('serializes concurrent connection and binding writes without losing records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-connections-concurrent-'))
    const store = new PluginConnectionStore(root)
    const [one, two] = await Promise.all([
      store.saveConnection(input),
      store.saveConnection({ ...input, serverOrigin: 'https://other.example.com', serverUrl: 'https://other.example.com/mcp' })
    ])
    await Promise.all([
      store.bindPlugin({ pluginId: 'one.plugin', serverId: 'api', connectionId: one.id }),
      store.bindPlugin({ pluginId: 'two.plugin', serverId: 'api', connectionId: two.id })
    ])

    expect(await store.listConnections()).toHaveLength(2)
    expect(await store.listBindings()).toHaveLength(2)
  })

  it('updates only stable connection status fields and removes dangling bindings with a connection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-connections-state-'))
    const store = new PluginConnectionStore(root)
    const connection = await store.saveConnection(input)
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'api', connectionId: connection.id })

    const updated = await store.updateConnection(connection.id, {
      state: 'connected', accountLabel: 'a***@example.com', lastConnectedAt: 123
    })
    expect(updated).toMatchObject({ state: 'connected', accountLabel: 'a***@example.com', lastConnectedAt: 123 })
    await store.removeConnection(connection.id)
    expect(await store.listConnections()).toEqual([])
    expect(await store.listBindings()).toEqual([])
  })

  it('ignores malformed or oversized persisted metadata instead of returning attacker-controlled fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-connections-invalid-'))
    await writeFile(join(root, 'plugin-connections.json'), JSON.stringify({ schemaVersion: 1, connections: [{ ...input, id: '../bad' }], bindings: [] }))
    const store = new PluginConnectionStore(root)
    expect(await store.listConnections()).toEqual([])
    await writeFile(join(root, 'plugin-connections.json'), 'x'.repeat(257 * 1024))
    expect(await store.listConnections()).toEqual([])
    expect(await readFile(join(root, 'plugin-connections.json'), 'utf8')).toHaveLength(257 * 1024)
  })
})
