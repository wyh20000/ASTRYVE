import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CODEX_OFFICIAL_SOURCE_ID, PluginMarketplace, parseMarketplaceIndex } from './pluginMarketplace'

const packageBytes = Buffer.from('plugin archive')
const digest = createHash('sha256').update(packageBytes).digest('hex')

const index = {
  schemaVersion: 1,
  generatedAt: '2026-09-10T00:00:00.000Z',
  plugins: [{
    id: 'acme.browser', name: 'Acme Browser', version: '1.2.0', description: 'Inspect pages',
    author: 'Acme', packageUrl: 'https://example.com/acme.zip', sha256: digest,
    permissions: ['browser.read'], categories: ['browser'], changelog: 'Safer inspection', recommended: true,
    capabilities: ['Inspect'], components: ['tools'], dataTargets: ['当前标签页'],
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
    expect(parsed[0]).toMatchObject({
      recommended: false,
      capabilities: ['Inspect'],
      components: ['tools'],
      dataTargets: ['当前标签页']
    })
  })

  it('keeps legacy schema-v1 entries browsable but blocks install when component metadata is absent', () => {
    const source = { id: 'legacy', name: 'Legacy', kind: 'community' as const, url: 'https://example.com/index.json', enabled: true, verified: false }
    const legacy = { ...index.plugins[0] } as Record<string, unknown>
    delete legacy.components
    const parsed = parseMarketplaceIndex({ ...index, plugins: [legacy] }, source)
    expect(parsed[0]).toMatchObject({ components: undefined, installable: false })
    expect(parsed[0].unavailableReason).toContain('组件声明')
  })

  it.each([
    { components: ['mcp'] }, { components: ['hooks'] }, { components: ['tools', 'hooks'] }
  ] as Array<{ components: Array<'mcp' | 'hooks' | 'tools'> }>)(
    'allows implemented community component set $components to be installed',
    ({ components }) => {
      const source = { id: 'community', name: 'Community', kind: 'community' as const, url: 'https://example.com/index.json', enabled: true, verified: false }
      const raw = { ...index.plugins[0], components: [...components] }
      const parsed = parseMarketplaceIndex({ ...index, plugins: [raw] }, source)
      expect(parsed[0].components).toEqual(expect.arrayContaining(components))
      expect(parsed[0]).toMatchObject({ installable: true, unavailableReason: undefined })
    }
  )

  it('rejects unsafe URLs, duplicate releases and invalid digests', () => {
    const source = { id: 'x', name: 'X', kind: 'github' as const, url: 'https://example.com/index.json', enabled: true, verified: false }
    expect(() => parseMarketplaceIndex({ ...index, plugins: [{ ...index.plugins[0], packageUrl: 'http://example.com/a.zip' }] }, source)).toThrow('HTTPS')
    expect(() => parseMarketplaceIndex({ ...index, plugins: [{ ...index.plugins[0], sha256: 'bad' }] }, source)).toThrow('摘要')
    expect(() => parseMarketplaceIndex({ ...index, plugins: [index.plugins[0], index.plugins[0]] }, source)).toThrow('重复')
    expect(() => parseMarketplaceIndex({ ...index, plugins: [{ ...index.plugins[0], signature: undefined, signingKeyId: 'spoofed' }] }, source))
      .toThrow('签名标识')
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
    const market = new PluginMarketplace(root, fetcher, { includeOfficial: false })
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
    const market = new PluginMarketplace(root, fetch, { includeOfficial: false })
    const source = await market.addSource({ name: 'Signed', url: 'https://example.com/index.json', signingKeyId: 'key-1', signingPublicKey: pem })
    expect(source).toMatchObject({ signingKeyId: 'key-1', signingPublicKey: pem })
    expect(() => parseMarketplaceIndex({ ...index, plugins: [{ ...index.plugins[0], signature: 'AA==', signingKeyId: 'other' }] }, source))
      .toThrow('匹配的来源公钥')
  })

  it('ships and synchronizes the verified Codex official source by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-market-official-'))
    const commit = 'a'.repeat(40)
    const catalog = { name: 'openai-curated', plugins: [{
      name: 'docs-helper', source: { source: 'local', path: './plugins/docs-helper' }, category: 'Developer Tools'
    }] }
    const manifest = {
      name: 'docs-helper', version: '1.2.3', description: 'Use official documentation',
      author: { name: 'OpenAI' }, skills: './skills/', permissions: ['workspace.read'],
      interface: {
        displayName: 'Docs Helper', capabilities: ['Read'], brandColor: '#3366FF',
        composerIcon: './assets/composer.svg', logo: './assets/logo.png', logoDark: './assets/logo-dark.png'
      }
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(catalog), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: commit }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest), { status: 200 }))
    const market = new PluginMarketplace(root, fetcher)
    const snapshot = await market.snapshot()
    expect(snapshot.sources[0]).toMatchObject({ id: CODEX_OFFICIAL_SOURCE_ID, kind: 'official', verified: true, enabled: true })
    expect(snapshot.entries[0]).toMatchObject({
      id: 'docs-helper', name: 'Docs Helper', version: '1.2.3', verified: true, installable: true,
      permissions: ['workspace.read'], capabilities: ['Read'], components: ['skills'], repository: { ref: commit, path: 'plugins/docs-helper' }
    })
    expect(snapshot.entries[0]).toMatchObject({
      brandColor: '#3366FF',
      composerIconUrl: `https://raw.githubusercontent.com/openai/plugins/${commit}/plugins/docs-helper/assets/composer.svg`,
      logoUrl: `https://raw.githubusercontent.com/openai/plugins/${commit}/plugins/docs-helper/assets/logo.png`,
      logoDarkUrl: `https://raw.githubusercontent.com/openai/plugins/${commit}/plugins/docs-helper/assets/logo-dark.png`
    })
    await expect(market.removeSource(CODEX_OFFICIAL_SOURCE_ID)).rejects.toThrow('不能删除')
    await expect(market.setSourceEnabled(CODEX_OFFICIAL_SOURCE_ID, false)).rejects.toThrow('不能禁用')
  })
})
