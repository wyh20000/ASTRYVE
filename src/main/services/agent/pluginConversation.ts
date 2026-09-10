import type { PluginMetadata } from '../../../shared/types'

const MENTION = /(^|\s)@([a-z0-9][a-z0-9._-]{1,63})(?=\s|$)/i

export interface PluginSelection {
  pluginIds: string[]
  cleanedRequest: string
  trigger?: string
}

export function resolvePluginSelection(
  request: string,
  explicitIds: readonly string[],
  plugins: readonly PluginMetadata[]
): PluginSelection {
  if (explicitIds.length) {
    const ids = unique(explicitIds)
    for (const id of ids) requireAvailable(id, plugins)
    return { pluginIds: ids, cleanedRequest: request }
  }
  const match = MENTION.exec(request)
  if (!match) return { pluginIds: [], cleanedRequest: request }
  const id = match[2].toLowerCase()
  requireAvailable(id, plugins)
  const start = match.index + match[1].length
  return {
    pluginIds: [id],
    cleanedRequest: `${request.slice(0, start)}${request.slice(start + id.length + 1)}`.replace(/\s{2,}/g, ' ').trim(),
    trigger: `@${id}`
  }
}

function requireAvailable(id: string, plugins: readonly PluginMetadata[]): PluginMetadata {
  const plugin = plugins.find((item) => item.id === id)
  if (!plugin) throw new Error(`插件 @${id} 未安装`)
  if (plugin.status !== 'ready') throw new Error(`插件 @${id} 无效，无法用于当前任务`)
  if (!plugin.enabled) throw new Error(`插件 @${id} 未启用`)
  return plugin
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))]
}
