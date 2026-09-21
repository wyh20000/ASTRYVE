import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginConnectionStore } from './pluginConnectionStore'
import { PluginCredentialVault, type CredentialEncryptionAdapter } from './pluginCredentials'
import { PluginConnectionService } from './pluginConnectionService'

const declarations = [{
  id: 'api', url: 'https://api.example.com/mcp', transport: 'streamable-http' as const,
  auth: 'api-key' as const, apiKeyHeader: 'Authorization' as const
}, {
  id: 'public', url: 'https://public.example.com/mcp', transport: 'streamable-http' as const,
  auth: 'none' as const
}]

function encryption(): CredentialEncryptionAdapter {
  return {
    available: async () => true,
    encrypt: async (value) => Buffer.from(`encrypted:${value}`),
    decrypt: async (value) => value.toString().replace(/^encrypted:/, '')
  }
}

describe('PluginConnectionService', () => {
  let root: string
  let store: PluginConnectionStore
  let vault: PluginCredentialVault
  const connectBinding = vi.fn()
  const disconnect = vi.fn()
  const audit = vi.fn()

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'plugin-connection-service-'))
    store = new PluginConnectionStore(root)
    vault = new PluginCredentialVault(root, encryption())
    connectBinding.mockReset()
    disconnect.mockReset()
    audit.mockReset()
  })

  function service(): PluginConnectionService {
    return new PluginConnectionService({
      store, vault,
      manager: { connectBinding, disconnect },
      listPlugins: async () => [{
        id: 'acme.remote', name: 'Acme Remote', description: 'Remote tools', source: 'installed' as const,
        sourceFormat: 'native' as const, enabled: true, status: 'ready' as const,
        permissions: ['network' as const], capabilities: [], components: ['mcp' as const], errors: []
      }],
      resolveDeclarations: async (pluginId) => pluginId === 'acme.remote' ? declarations : [],
      audit
    })
  }

  it('returns declared servers and sanitized compatible connections without credential values', async () => {
    const connection = await store.saveConnection({
      serverOrigin: 'https://api.example.com', serverUrl: declarations[0].url,
      auth: 'api-key', state: 'connected', accountLabel: 'work account'
    })
    await vault.set(connection.id, 'api-key', 'secret-value')

    const result = await service().list()

    expect(result).toEqual([{
      pluginId: 'acme.remote', pluginName: 'Acme Remote', enabled: true, restricted: false,
      servers: [{
        id: 'api', serverOrigin: 'https://api.example.com', auth: 'api-key', state: 'pending',
        compatibleConnections: [{
          id: connection.id, serverOrigin: 'https://api.example.com', auth: 'api-key',
          state: 'connected', accountLabel: 'work account'
        }]
      }, {
        id: 'public', serverOrigin: 'https://public.example.com', auth: 'none', state: 'pending',
        compatibleConnections: []
      }]
    }])
    expect(JSON.stringify(result)).not.toContain('secret-value')
  })

  it('stores an API key once, binds the new connection, and returns refreshed sanitized state', async () => {
    connectBinding.mockImplementation(async (input: { connectionId: string }) => {
      await store.updateConnection(input.connectionId, { state: 'connected', lastConnectedAt: 10 })
    })

    const result = await service().connect({
      pluginId: 'acme.remote', serverId: 'api', credential: 'Bearer secret', accountLabel: 'work'
    })

    const binding = (await store.listBindings())[0]
    expect(binding).toMatchObject({ pluginId: 'acme.remote', serverId: 'api' })
    expect(await vault.get(binding.connectionId, 'api-key')).toBe('Bearer secret')
    expect(connectBinding).toHaveBeenCalledWith({
      pluginId: 'acme.remote', serverId: 'api', connectionId: binding.connectionId, restart: false
    })
    expect(JSON.stringify(result)).not.toContain('Bearer secret')
    expect(result[0].servers[0]).toMatchObject({ state: 'connected', connectionId: binding.connectionId })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'plugin.connection.connect', outcome: 'success', pluginId: 'acme.remote', connectionId: binding.connectionId
    }))
    expect(JSON.stringify(audit.mock.calls)).not.toContain('Bearer secret')
  })

  it('binds a compatible existing connection without copying credentials', async () => {
    const existing = await store.saveConnection({
      serverOrigin: 'https://api.example.com', serverUrl: declarations[0].url,
      auth: 'api-key', state: 'connected'
    })

    await service().connect({ pluginId: 'acme.remote', serverId: 'api', connectionId: existing.id })

    expect(await store.findBinding('acme.remote', 'api')).toEqual({
      pluginId: 'acme.remote', serverId: 'api', connectionId: existing.id
    })
    expect(connectBinding).toHaveBeenCalledWith({
      pluginId: 'acme.remote', serverId: 'api', connectionId: existing.id, restart: false
    })
  })

  it('removes a newly stored credential, binding and connection when startup fails', async () => {
    connectBinding.mockRejectedValue(new Error('server unavailable'))

    await expect(service().connect({
      pluginId: 'acme.remote', serverId: 'api', credential: 'must-be-removed'
    })).rejects.toThrow('server unavailable')

    const attemptedId = connectBinding.mock.calls[0][0].connectionId as string
    expect(disconnect).toHaveBeenCalledWith(attemptedId)
    expect(await vault.get(attemptedId, 'api-key')).toBeUndefined()
    expect(await store.getConnection(attemptedId)).toBeUndefined()
    expect(await store.listBindings()).toEqual([])
    expect(JSON.stringify(audit.mock.calls)).not.toContain('must-be-removed')
  })

  it('restarts a bound connection for retry and removes it on disconnect', async () => {
    const existing = await store.saveConnection({
      serverOrigin: 'https://api.example.com', serverUrl: declarations[0].url,
      auth: 'api-key', state: 'failed', errorCode: 'MCP_CONNECT_FAILED'
    })
    await store.bindPlugin({ pluginId: 'acme.remote', serverId: 'api', connectionId: existing.id })
    disconnect.mockImplementation(async (connectionId: string) => {
      await vault.deleteConnection(connectionId)
      await store.removeConnection(connectionId)
    })

    await service().retry({ pluginId: 'acme.remote', serverId: 'api' })
    expect(connectBinding).toHaveBeenCalledWith({
      pluginId: 'acme.remote', serverId: 'api', connectionId: existing.id, restart: true
    })

    await service().disconnect({ connectionId: existing.id })
    expect(disconnect).toHaveBeenCalledWith(existing.id)
    expect(await store.getConnection(existing.id)).toBeUndefined()
  })

  it('refuses connections for disabled plugins or plugins without network permission', async () => {
    const target = service()
    const plugin = (await target.list())[0]
    expect(plugin.restricted).toBe(false)

    await expect(new PluginConnectionService({
      store, vault, manager: { connectBinding, disconnect },
      listPlugins: async () => [{ ...await (async () => ({
        id: 'acme.remote', name: 'Acme Remote', description: '', source: 'installed' as const,
        sourceFormat: 'native' as const, enabled: false, status: 'ready' as const,
        permissions: [] as never[], capabilities: [], components: ['mcp' as const], errors: []
      }))() }],
      resolveDeclarations: async () => declarations
    }).connect({ pluginId: 'acme.remote', serverId: 'public' })).rejects.toThrow('插件未启用或缺少联网权限')
  })

  it('isolates one broken plugin declaration while retaining healthy connection views', async () => {
    const target = new PluginConnectionService({
      store, vault, manager: { connectBinding, disconnect },
      listPlugins: async () => [{
        id: 'broken.remote', name: 'Broken', description: '', source: 'installed', sourceFormat: 'native',
        enabled: true, status: 'ready', permissions: ['network'], capabilities: [], components: ['mcp'], errors: []
      }, {
        id: 'acme.remote', name: 'Acme Remote', description: '', source: 'installed', sourceFormat: 'native',
        enabled: true, status: 'ready', permissions: ['network'], capabilities: [], components: ['mcp'], errors: []
      }],
      resolveDeclarations: async (pluginId) => {
        if (pluginId === 'broken.remote') throw new Error('untrusted manifest detail')
        return declarations
      }
    })

    const result = await target.list()

    expect(result.find((item) => item.pluginId === 'acme.remote')?.servers).toHaveLength(2)
    expect(result.find((item) => item.pluginId === 'broken.remote')).toMatchObject({ restricted: true, servers: [] })
    expect(JSON.stringify(result)).not.toContain('untrusted manifest detail')
  })

  it('stops before storing credentials when the required request audit is unavailable', async () => {
    const target = new PluginConnectionService({
      store, vault, manager: { connectBinding, disconnect },
      listPlugins: async () => [{
        id: 'acme.remote', name: 'Acme Remote', description: '', source: 'installed', sourceFormat: 'native',
        enabled: true, status: 'ready', permissions: ['network'], capabilities: [], components: ['mcp'], errors: []
      }],
      resolveDeclarations: async () => declarations,
      audit: () => { throw new Error('audit unavailable') }
    })

    await expect(target.connect({
      pluginId: 'acme.remote', serverId: 'api', credential: 'must-not-persist'
    })).rejects.toThrow('audit unavailable')
    expect(await store.listConnections()).toEqual([])
    expect(await store.listBindings()).toEqual([])
  })
})
