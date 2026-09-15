import { mkdir, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { PluginMetadata } from '../../../shared/types'
import { readPluginManifest } from './pluginManifest'

const IGNORED_PREFIXES = ['.staging-', '.backup-', '.trash-']

export class PluginRegistry {
  constructor(private readonly root: string, private readonly disabledIds: () => Set<string>) {}

  async list(): Promise<PluginMetadata[]> {
    await mkdir(this.root, { recursive: true })
    const entries = await readdir(this.root, { withFileTypes: true })
    const disabled = this.disabledIds()
    const plugins = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !IGNORED_PREFIXES.some((prefix) => entry.name.startsWith(prefix)))
      .map(async (entry): Promise<PluginMetadata> => {
        try {
          const parsed = await readPluginManifest(join(this.root, entry.name))
          const { tools: _tools, hooks: _hooks, skillsPath: _skillsPath, ...metadata } = parsed
          return { ...metadata, source: 'installed', enabled: !disabled.has(parsed.id), status: 'ready', errors: [] }
        } catch (error) {
          const id = safeFolderId(entry.name)
          return {
            id, name: entry.name.slice(0, 100), description: '', source: 'installed', sourceFormat: 'native',
            enabled: false, status: 'invalid', permissions: [], capabilities: [], components: [],
            errors: [error instanceof Error ? error.message : '插件清单加载失败']
          }
        }
      }))
    const counts = new Map<string, number>()
    for (const plugin of plugins) counts.set(plugin.id, (counts.get(plugin.id) ?? 0) + 1)
    for (const plugin of plugins) {
      if ((counts.get(plugin.id) ?? 0) > 1) {
        plugin.enabled = false
        plugin.status = 'invalid'
        plugin.errors = ['插件标识重复']
      }
    }
    return plugins.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id))
  }
}

function safeFolderId(name: string): string {
  const safe = basename(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe.length >= 2 ? safe.slice(0, 64) : `invalid-${safe || 'plugin'}`
}
