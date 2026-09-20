import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPluginAsset, readPluginIcon } from './pluginAssets'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZkAAAAASUVORK5CYII=', 'base64')

async function plugin(icon: string, assets: string[] = []): Promise<{ installed: string; root: string }> {
  const installed = await mkdtemp(join(tmpdir(), 'plugin-assets-'))
  const root = join(installed, 'example.plugin')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'plugin.json'), JSON.stringify({
    schemaVersion: 1, id: 'example.plugin', name: 'Example', skills: './skills', icon, assets
  }))
  return { installed, root }
}

describe('readPluginIcon', () => {
  it('returns only a declared image from the plugin assets directory', async () => {
    const { installed, root } = await plugin('assets/icon.png')
    try {
      await writeFile(join(root, 'assets', 'icon.png'), png)
      expect(await readPluginIcon(installed, 'example.plugin')).toBe(`data:image/png;base64,${png.toString('base64')}`)
    } finally { await rm(installed, { recursive: true, force: true }) }
  })

  it('allows only manifest-declared static assets, without exposing sibling files', async () => {
    const { installed, root } = await plugin('assets/icon.png', ['assets/banner.webp'])
    try {
      await writeFile(join(root, 'assets', 'icon.png'), png)
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('VP8 ')])
      await writeFile(join(root, 'assets', 'banner.webp'), webp)
      await writeFile(join(root, 'assets', 'private.png'), png)
      expect(await readPluginAsset(installed, 'example.plugin', 'assets/banner.webp')).toBe(`data:image/webp;base64,${webp.toString('base64')}`)
      await expect(readPluginAsset(installed, 'example.plugin', 'assets/private.png')).rejects.toThrow('未声明')
      await expect(readPluginAsset(installed, 'example.plugin', '../outside.png')).rejects.toThrow('未声明')
    } finally { await rm(installed, { recursive: true, force: true }) }
  })

  it('rejects traversal, executable formats, mismatched bytes and oversized files', async () => {
    for (const icon of ['../outside.png', 'assets/../outside.png', 'assets/icon.svg', 'https://example.com/icon.png']) {
      const { installed } = await plugin(icon)
      try { await expect(readPluginIcon(installed, 'example.plugin')).rejects.toThrow('插件图标必须') }
      finally { await rm(installed, { recursive: true, force: true }) }
    }
    const { installed, root } = await plugin('assets/icon.png')
    try {
      await writeFile(join(root, 'assets', 'icon.png'), '<svg onload="alert(1)"/>')
      await expect(readPluginIcon(installed, 'example.plugin')).rejects.toThrow('内容与文件类型不符')
      await writeFile(join(root, 'assets', 'icon.png'), Buffer.alloc(256 * 1024 + 1))
      await expect(readPluginIcon(installed, 'example.plugin')).rejects.toThrow('过大')
      await expect(readPluginIcon(installed, '../example.plugin')).rejects.toThrow('插件标识无效')
    } finally { await rm(installed, { recursive: true, force: true }) }
  })

  it('rejects an asset symlink', async () => {
    const { installed, root } = await plugin('assets/icon.png')
    try {
      const outside = join(installed, 'outside.png')
      await writeFile(outside, png)
      try { await symlink(outside, join(root, 'assets', 'icon.png')) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return // Windows without symlink privilege
        throw error
      }
      await expect(readPluginIcon(installed, 'example.plugin')).rejects.toThrow('插件图标路径无效')
    } finally { await rm(installed, { recursive: true, force: true }) }
  })
})
