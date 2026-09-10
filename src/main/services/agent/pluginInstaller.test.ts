import { readFile, lstat, mkdir, mkdtemp, rename, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { importPluginPackage, replacePluginDirectoryAtomically } from './pluginInstaller'

const manifest = (id: string) => ({
  schemaVersion: 1, id, name: id, version: '1.0.0', description: `${id} plugin`, skills: './skills'
})

async function roots(): Promise<{ installed: string; source: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ai-agent-plugin-import-'))
  const installed = join(root, 'installed')
  const source = join(root, 'source')
  await mkdir(installed)
  await mkdir(source)
  return { installed, source }
}

describe('importPluginPackage', () => {
  it('copies a validated folder into an atomic id-named destination', async () => {
    const { installed, source } = await roots()
    await mkdir(join(source, 'skills'))
    await writeFile(join(source, 'plugin.json'), JSON.stringify(manifest('acme.tools')))
    await writeFile(join(source, 'skills', 'SKILL.md'), '# Acme')

    const result = await importPluginPackage(installed, source)

    expect(result).toMatchObject({ id: 'acme.tools', status: 'ready', enabled: true })
    expect(await readFile(join(installed, 'acme.tools', 'skills', 'SKILL.md'), 'utf8')).toBe('# Acme')
    expect((await lstat(join(installed, 'acme.tools'))).isDirectory()).toBe(true)
  })

  it('imports a ZIP with one wrapper directory and rejects traversal names', async () => {
    const { installed, source } = await roots()
    const good = new JSZip()
    good.file('bundle/plugin.json', JSON.stringify(manifest('zip.tools')))
    good.file('bundle/skills/SKILL.md', '# Zip')
    const goodPath = join(source, 'good.zip')
    await writeFile(goodPath, await good.generateAsync({ type: 'nodebuffer' }))
    await expect(importPluginPackage(installed, goodPath)).resolves.toMatchObject({ id: 'zip.tools' })

    const bad = new JSZip()
    bad.file('../outside.txt', 'escape')
    bad.file('plugin.json', JSON.stringify(manifest('bad.zip')))
    bad.file('skills/SKILL.md', '# Bad')
    const badPath = join(source, 'bad.zip')
    await writeFile(badPath, await bad.generateAsync({ type: 'nodebuffer' }))
    await expect(importPluginPackage(installed, badPath)).rejects.toThrow('ZIP 包含越界路径')

    const ads = new JSZip()
    ads.file('plugin.json', JSON.stringify(manifest('ads.zip')))
    ads.file('skills/readme.txt:payload', 'hidden stream')
    const adsPath = join(source, 'ads.zip')
    await writeFile(adsPath, await ads.generateAsync({ type: 'nodebuffer' }))
    await expect(importPluginPackage(installed, adsPath)).rejects.toThrow('ZIP 包含无效路径')
  })

  it('rejects an excessively deep directory tree', async () => {
    const { installed, source } = await roots()
    await writeFile(join(source, 'plugin.json'), JSON.stringify(manifest('deep.tools')))
    let current = source
    for (let index = 0; index < 34; index += 1) {
      current = join(current, `d${index}`)
      await mkdir(current)
    }
    await expect(importPluginPackage(installed, source)).rejects.toThrow('插件包目录层级超过限制')
  })

  it('rejects excessive entry counts, total expanded size and suspicious compression ratios', async () => {
    const many = await roots()
    const manyZip = new JSZip()
    manyZip.file('plugin.json', JSON.stringify(manifest('many.tools')))
    for (let index = 0; index < 1_001; index += 1) manyZip.file(`skills/f${index}.txt`, '')
    const manyPath = join(many.source, 'many.zip')
    await writeFile(manyPath, await manyZip.generateAsync({ type: 'nodebuffer' }))
    await expect(importPluginPackage(many.installed, manyPath)).rejects.toThrow('文件数量超过限制')

    const total = await roots()
    await writeFile(join(total.source, 'plugin.json'), JSON.stringify(manifest('total.tools')))
    await mkdir(join(total.source, 'skills'))
    for (let index = 0; index < 6; index += 1) {
      await writeFile(join(total.source, 'skills', `large-${index}.bin`), Buffer.alloc(4_500_000, index))
    }
    await expect(importPluginPackage(total.installed, total.source)).rejects.toThrow('总大小超过限制')

    const compressed = await roots()
    const compressedZip = new JSZip()
    compressedZip.file('plugin.json', JSON.stringify(manifest('compressed.tools')))
    compressedZip.file('skills/repeated.txt', 'a'.repeat(1024 * 1024))
    const compressedPath = join(compressed.source, 'compressed.zip')
    await writeFile(compressedPath, await compressedZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }))
    await expect(importPluginPackage(compressed.installed, compressedPath)).rejects.toThrow('压缩比超过安全限制')
  })

  it('rejects links, native executables and oversized files before installation', async () => {
    const linked = await roots()
    await writeFile(join(linked.source, 'plugin.json'), JSON.stringify(manifest('linked.tools')))
    await mkdir(join(linked.source, 'skills'))
    const linkedTarget = await mkdtemp(join(tmpdir(), 'ai-agent-plugin-linked-target-'))
    await symlink(linkedTarget, join(linked.source, 'skills', 'linked'), 'junction')
    await expect(importPluginPackage(linked.installed, linked.source)).rejects.toThrow('不允许符号链接')

    const executable = await roots()
    await writeFile(join(executable.source, 'plugin.json'), JSON.stringify(manifest('native.tools')))
    await mkdir(join(executable.source, 'skills'))
    await writeFile(join(executable.source, 'skills', 'payload.exe'), 'MZ')
    await expect(importPluginPackage(executable.installed, executable.source)).rejects.toThrow('不允许导入原生可执行文件')

    const oversized = await roots()
    await writeFile(join(oversized.source, 'plugin.json'), JSON.stringify(manifest('large.tools')))
    await mkdir(join(oversized.source, 'skills'))
    await writeFile(join(oversized.source, 'skills', 'large.bin'), Buffer.alloc(5 * 1024 * 1024 + 1))
    await expect(importPluginPackage(oversized.installed, oversized.source)).rejects.toThrow('单个文件超过限制')
  })

  it('preserves the installed version when an update fails validation', async () => {
    const { installed, source } = await roots()
    await mkdir(join(source, 'skills'))
    await writeFile(join(source, 'plugin.json'), JSON.stringify(manifest('stable.tools')))
    await writeFile(join(source, 'skills', 'SKILL.md'), 'original')
    await importPluginPackage(installed, source)

    const invalid = join((await roots()).source)
    await writeFile(join(invalid, 'plugin.json'), JSON.stringify(manifest('stable.tools')))
    await mkdir(join(invalid, 'skills'))
    await writeFile(join(invalid, 'skills', 'payload.dll'), 'bad update')
    await expect(importPluginPackage(installed, invalid)).rejects.toThrow('不允许导入原生可执行文件')
    expect(await readFile(join(installed, 'stable.tools', 'skills', 'SKILL.md'), 'utf8')).toBe('original')
  })

  it('rejects a market package identity mismatch before replacing the installed plugin', async () => {
    const current = await roots()
    await mkdir(join(current.source, 'skills'))
    await writeFile(join(current.source, 'plugin.json'), JSON.stringify(manifest('stable.tools')))
    await writeFile(join(current.source, 'skills', 'SKILL.md'), 'original')
    await importPluginPackage(current.installed, current.source)

    const update = await roots()
    const wrongManifest = { ...manifest('other.tools'), version: '2.0.0' }
    await mkdir(join(update.source, 'skills'))
    await writeFile(join(update.source, 'plugin.json'), JSON.stringify(wrongManifest))
    await writeFile(join(update.source, 'skills', 'SKILL.md'), 'wrong package')

    await expect(importPluginPackage(current.installed, update.source, {
      expectedId: 'stable.tools', expectedVersion: '2.0.0'
    })).rejects.toThrow('下载包身份与市场索引不一致')
    expect(await readFile(join(current.installed, 'stable.tools', 'skills', 'SKILL.md'), 'utf8')).toBe('original')
    await expect(lstat(join(current.installed, 'other.tools'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a duplicate id already owned by a differently named installed directory', async () => {
    const { installed, source } = await roots()
    await mkdir(join(installed, 'legacy-folder'))
    await writeFile(join(installed, 'legacy-folder', 'plugin.json'), JSON.stringify(manifest('occupied.tools')))
    await mkdir(join(source, 'skills'))
    await writeFile(join(source, 'plugin.json'), JSON.stringify(manifest('occupied.tools')))
    await expect(importPluginPackage(installed, source)).rejects.toThrow('插件标识已由其他目录占用')
  })

  it('restores the previous directory if the final atomic rename fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-agent-plugin-rollback-'))
    const stage = join(root, '.staging-test')
    const destination = join(root, 'stable.tools')
    await mkdir(stage)
    await mkdir(destination)
    await writeFile(join(stage, 'new.txt'), 'new')
    await writeFile(join(destination, 'old.txt'), 'old')

    await expect(replacePluginDirectoryAtomically(stage, stage, destination, 'stable.tools', async (from, to) => {
      if (from === stage) throw new Error('simulated rename failure')
      await rename(from, to)
    })).rejects.toThrow('simulated rename failure')

    expect(await readFile(join(destination, 'old.txt'), 'utf8')).toBe('old')
  })
})
