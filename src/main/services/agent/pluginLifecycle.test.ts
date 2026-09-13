import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PluginMarketEntry } from '../../../shared/types'
import { installMarketPlugin, verifyPluginArchive, verifyPluginSignature } from './pluginLifecycle'
import { initPluginRegistry, listPlugins } from './pluginManager'

describe('plugin lifecycle verification', () => {
  it('accepts the exact SHA-256 and rejects tampered packages', () => {
    const bytes = Buffer.from('plugin')
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(() => verifyPluginArchive(bytes, digest)).not.toThrow()
    expect(() => verifyPluginArchive(Buffer.from('tampered'), digest)).toThrow('摘要')
  })

  it('verifies Ed25519 package signatures and rejects tampering', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const bytes = Buffer.from('signed plugin')
    const entry = {
      signature: sign(null, bytes, privateKey).toString('base64'),
      signingPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString()
    }
    expect(() => verifyPluginSignature(bytes, entry)).not.toThrow()
    expect(() => verifyPluginSignature(Buffer.from('tampered'), entry)).toThrow('签名')
  })

  it('installs a supported official repository plugin from a pinned tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'official-plugin-install-'))
    const installed = join(root, 'plugins')
    const ref = 'a'.repeat(40)
    const files = new Map([
      ['plugins/docs-helper/.codex-plugin/plugin.json', Buffer.from(JSON.stringify({
        name: 'docs-helper', version: '1.2.3', description: 'Official docs', skills: './skills/'
      }))],
      ['plugins/docs-helper/skills/docs/SKILL.md', Buffer.from('---\nname: docs\ndescription: Read docs\n---\nUse official docs.')]
    ])
    const blobSha = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
    const tree = { truncated: false, tree: [...files].map(([path, bytes]) => ({
      path, type: 'blob', mode: '100644', size: bytes.byteLength, sha: blobSha(bytes)
    })) }
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/git/trees/')) return new Response(JSON.stringify(tree), { status: 200 })
      const path = [...files.keys()].find((candidate) => url.endsWith(candidate))
      return path ? new Response(files.get(path), { status: 200 }) : new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const entry: PluginMarketEntry = {
      id: 'docs-helper', name: 'Docs Helper', version: '1.2.3', description: 'Official docs', author: 'OpenAI',
      sourceId: 'official', sourceName: 'Codex official', sourceKind: 'official', verified: true,
      permissions: [], categories: [], platforms: [], architectures: [], components: ['skills'], installable: true,
      repository: { owner: 'openai', repo: 'plugins', ref, path: 'plugins/docs-helper' }
    }
    const result = await installMarketPlugin(entry, root, installed, fetcher)
    expect(result).toMatchObject({
      id: 'docs-helper', version: '1.2.3', sourceFormat: 'codex',
      marketOrigin: { sourceId: 'official', sourceKind: 'official', verified: true, publisherId: 'github:openai/plugins' }
    })
    expect(await readFile(join(installed, 'docs-helper', 'skills', 'docs', 'SKILL.md'), 'utf8')).toContain('Use official docs')
    initPluginRegistry(root)
    await expect(listPlugins()).resolves.toEqual([expect.objectContaining({ marketOrigin: result.marketOrigin })])
  })
})
