/**
 * 一次性诊断：确认官方市场同步结果，并在失败时输出 source.error。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginMarketplace } from './agent/pluginMarketplace'

export async function runMarketIconDiagnostics(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'market-diag-'))
  try {
    const market = new PluginMarketplace(dir)
    const snapshot = await market.snapshot()

    for (const s of snapshot.sources) {
      console.log(
        `[market-diag] source="${s.name}" lastSyncAt=${s.lastSyncAt ?? '-'} error=${s.error ?? '-'}`
      )
    }

    const entries = snapshot.entries
    console.log('[market-diag] 条目数:', entries.length)
    console.log('[market-diag] logoUrl:', entries.filter((e) => e.logoUrl).length)
    console.log('[market-diag] composerIconUrl:', entries.filter((e) => e.composerIconUrl).length)
    console.log('[market-diag] brandColor:', entries.filter((e) => e.brandColor).length)

    for (const e of entries.slice(0, 4)) {
      console.log(
        `[market-diag] ${e.id} brand=${e.brandColor ?? '-'} logo=${e.logoUrl ? 'Y' : 'N'} composer=${e.composerIconUrl ? 'Y' : 'N'}`
      )
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
