import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PluginConnectionStore } from './pluginConnectionStore'
import {
  PluginCredentialVault, removePluginConnectionData, type CredentialEncryptionAdapter
} from './pluginCredentials'

const reversibleAdapter = (): CredentialEncryptionAdapter => ({
  available: async () => true,
  encrypt: async (value) => Buffer.from(`cipher:${value}`),
  decrypt: async (value) => value.toString().slice('cipher:'.length)
})
const unavailableAdapter = (): CredentialEncryptionAdapter => ({
  available: async () => false,
  encrypt: async () => Buffer.alloc(0),
  decrypt: async () => ''
})

describe('plugin credential vault', () => {
  it('persists only ciphertext and reads it through the encryption adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-credentials-'))
    const vault = new PluginCredentialVault(root, reversibleAdapter())
    await vault.set('11111111-1111-4111-8111-111111111111', 'access-token', 'plain-secret')

    expect(await vault.get('11111111-1111-4111-8111-111111111111', 'access-token')).toBe('plain-secret')
    expect(await readFile(join(root, 'plugin-credentials.json'), 'utf8')).not.toContain('plain-secret')
  })

  it('refuses persistence when OS encryption is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-credentials-unavailable-'))
    const vault = new PluginCredentialVault(root, unavailableAdapter())
    await expect(vault.set('11111111-1111-4111-8111-111111111111', 'api-key', 'secret'))
      .rejects.toThrow('系统加密')
  })

  it('serializes concurrent secret writes and deletes a whole connection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-credentials-concurrent-'))
    const vault = new PluginCredentialVault(root, reversibleAdapter())
    const id = '11111111-1111-4111-8111-111111111111'
    await Promise.all([
      vault.set(id, 'access-token', 'access'),
      vault.set(id, 'refresh-token', 'refresh')
    ])
    expect(await vault.get(id, 'access-token')).toBe('access')
    expect(await vault.get(id, 'refresh-token')).toBe('refresh')
    await vault.deleteConnection(id)
    expect(await vault.get(id, 'access-token')).toBeUndefined()
  })

  it('unbinds on keep, clears exclusively bound credentials on clear, and preserves shared credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-credential-cleanup-'))
    const store = new PluginConnectionStore(root)
    const vault = new PluginCredentialVault(root, reversibleAdapter())
    const exclusive = await store.saveConnection({
      serverOrigin: 'https://one.example.com', serverUrl: 'https://one.example.com/mcp', auth: 'api-key', state: 'connected'
    })
    const shared = await store.saveConnection({
      serverOrigin: 'https://two.example.com', serverUrl: 'https://two.example.com/mcp', auth: 'oauth2', state: 'connected'
    })
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'one', connectionId: exclusive.id })
    await store.bindPlugin({ pluginId: 'one.plugin', serverId: 'two', connectionId: shared.id })
    await store.bindPlugin({ pluginId: 'two.plugin', serverId: 'two', connectionId: shared.id })
    await vault.set(exclusive.id, 'api-key', 'exclusive-secret')
    await vault.set(shared.id, 'access-token', 'shared-secret')

    await removePluginConnectionData('one.plugin', 'clear', root, store, vault)

    expect(await vault.get(exclusive.id, 'api-key')).toBeUndefined()
    expect(await vault.get(shared.id, 'access-token')).toBe('shared-secret')
    expect((await store.listConnections()).map(({ id }) => id)).toEqual([shared.id])
    expect(await store.listBindings()).toEqual([{ pluginId: 'two.plugin', serverId: 'two', connectionId: shared.id }])
  })
})
