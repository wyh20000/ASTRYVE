import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PluginMarketplace, parseMarketplaceIndex } from './pluginMarketplace'

const packageBytes = Buffer.from('plugin archive')
const digest = createHash('sha256').update(packageBytes).digest('hex')

const index = {
  schemaVersion: 1,
  generatedAt: '2026-09-10T00:00:00.000Z',
  plugins: [{
    id: 'acme.browser', name: 'Acme Browser', version: '1.2.0', description: 'Inspect pages',
    author: 'Acme', packageUrl: 'https://example.com/acme.zip', sha256: digest,
    permissions: ['browser.read'], categories: ['browser'], changelog: 'Safer inspection',
    minAppVersion: '0.1.0', platforms: ['win32'], architectures: ['x64']
  }]
}

describe('plugin marketplace', () => {
  it('normalizes untrusted indexes without allowing community verification claims', () => {
    const parsed = parseMarketplaceIndex({ ...index, verified: true }, {
      id: 'community', name: 'Community', kind: 'community', url: 'https://example.com/index.json', enabled: true,
      verified: true
    })
    expect(parsed[0]).toMatchObject({ id: 'acme.browser', sourceId: 'community', verified: false })
    expect(parsed[0].permissions).toEqual(['browser.read'])
  })

  it('rejects unsafe URLs, duplicate releases and invalid digests', () => {
    const source = { id: 'x', name: 'X', kind: 'github' as const, url: 'https://example.com/index.json', enabled: true, verified: false }
    expect(() => parseMarketplaceIndex({ ...index, plugins: [{ ...index.plugins[0], packageUrl: 'http://example.com/a.zip' }] }, source)).toThrow('HTTPS')
    expect(() => parseMarketplaceIndex({ ...index, plugins: [{ ...index.plugins[0], sha256: 'bad' }] }, source)).toThrow('摘要')
    expect(() => parseMarketplaceIndex({ ...index, plugins: [index.plugins[0], index.plugins[0]] }, source)).toThrow('重复')
  })

  it('rejects malformed, future and stale marketplace indexes', () => {
    const source = { id: 'x', name: 'X', kind: 'community' as const, url: 'https://example.com/index.json', enabled: true, verified: false }
    const now = Date.parse('2026-09-10T00:00:00.000Z')
    expect(() => parseMarketplaceIndex({ ...index, generatedAt: 'not-a-date' }, source, now)).toThrow('生成时间')
    expect(() => parseMarketplaceIndex({ ...index, generatedAt: '2026-09-10T00:06:00.000Z' }, source, now)).toThrow('未来')
    expect(() => parseMarketplaceIndex({ ...index, generatedAt: '2026-08-10T23:59:59.000Z' }, source, now)).toThrow('已过期')
  })

  it('keeps the last good cached index when synchronization fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-market-'))
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(index), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'))
    const market = new PluginMarketplace(root, fetcher)
    const source = await market.addSource({ name: 'Acme', url: 'https://example.com/index.json' })
    const first = await market.syncSource(source.id)
    expect(first.entries).toHaveLength(1)
    const second = await market.syncSource(source.id)
    expect(second.entries).toHaveLength(1)
    expect(second.sources[0].error).toContain('offline')
    expect(JSON.parse(await readFile(join(root, 'plugin-market.json'), 'utf8')).entries).toHaveLength(1)
  })

  it('pins an optional Ed25519 source key and rejects unmatched signed entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-market-key-'))
    const { publicKey } = generateKeyPairSync('ed25519')
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const market = new PluginMarketplace(root)
    const source = await market.addSource({ name: 'Signed', url: 'https://example.com/index.json', signingKeyId: 'key-1', signingPublicKey: pem })
    expect(source).toMatchObject({ signingKeyId: 'key-1', signingPublicKey: pem })
    expect(() => parseMarketplaceIndex({ ...index, plugins: [{ ...index.plugins[0], signature: 'AA==', signingKeyId: 'other' }] }, source))
      .toThrow('匹配的来源公钥')
  })
})
