import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { PluginRegistry } from './pluginRegistry'

describe('PluginRegistry', () => {
  it('discovers installed packages, preserves invalid diagnostics and ignores staging folders', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'ai-agent-plugins-'))
    const plugins = join(userData, 'plugins')
    await mkdir(join(plugins, 'good'), { recursive: true })
    await mkdir(join(plugins, 'broken'), { recursive: true })
    await mkdir(join(plugins, '.staging-upload'), { recursive: true })
    await writeFile(join(plugins, 'good', 'plugin.json'), JSON.stringify({
      schemaVersion: 1, id: 'good', name: 'Good Plugin', version: '1.0.0', description: 'Works', permissions: [], skills: './skills'
    }))
    await writeFile(join(plugins, 'broken', 'plugin.json'), '{')

    const registry = new PluginRegistry(plugins, () => new Set(['good']))
    const result = await registry.list()

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'broken', status: 'invalid', enabled: false })
    expect(result[0].errors[0]).toContain('清单')
    expect(result[1]).toMatchObject({ id: 'good', status: 'ready', enabled: false, source: 'installed' })
    expect(JSON.stringify(result)).not.toContain(userData)
  })

  it('marks duplicate manifest ids invalid instead of selecting one implicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-agent-plugin-duplicates-'))
    for (const folder of ['one', 'two']) {
      await mkdir(join(root, folder), { recursive: true })
      await writeFile(join(root, folder, 'plugin.json'), JSON.stringify({
        schemaVersion: 1, id: 'same.plugin', name: folder, version: '1.0.0', description: folder, skills: './skills'
      }))
    }
    const result = await new PluginRegistry(root, () => new Set()).list()
    expect(result).toHaveLength(2)
    expect(result.every((plugin) => plugin.status === 'invalid' && plugin.enabled === false)).toBe(true)
    expect(result.every((plugin) => plugin.errors.includes('插件标识重复'))).toBe(true)
  })
})
