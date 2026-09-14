import type { PluginMarketEntry, PluginMetadata } from '../../../shared/types'
import { compareSemver } from '../../../shared/semver'

export function selectSafeAutoUpdates(
  installed: readonly PluginMetadata[],
  entries: readonly PluginMarketEntry[]
): PluginMarketEntry[] {
  const candidates = new Map<string, PluginMarketEntry>()
  for (const plugin of installed) {
    const origin = plugin.marketOrigin
    if (!plugin.version || plugin.status !== 'ready' || !origin?.publisherId) continue
    for (const entry of entries) {
      if (entry.id !== plugin.id || entry.sourceId !== origin.sourceId || entry.publisherId !== origin.publisherId ||
          entry.installable === false || compareSemver(entry.version, plugin.version) <= 0 ||
          entry.permissions.some((permission) => !plugin.permissions.includes(permission))) continue
      const current = candidates.get(plugin.id)
      if (!current || compareSemver(entry.version, current.version) > 0) candidates.set(plugin.id, entry)
    }
  }
  return [...candidates.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export async function runSafeAutoUpdates(
  candidates: readonly PluginMarketEntry[],
  install: (entry: PluginMarketEntry) => Promise<void>
): Promise<{ updated: string[]; failed: string[] }> {
  const updated: string[] = []
  const failed: string[] = []
  for (const entry of candidates) {
    try { await install(entry); updated.push(entry.id) } catch { failed.push(entry.id) }
  }
  return { updated, failed }
}
