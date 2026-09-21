import { describe, expect, it, vi } from 'vitest'
import type { PluginMarketEntry, PluginMetadata } from '../../../shared/types'
import { runSafeAutoUpdates, selectSafeAutoUpdates } from './pluginAutoUpdate'

const installed: PluginMetadata = {
  id: 'acme.tools', name: 'Tools', version: '1.0.0', description: '', source: 'installed', sourceFormat: 'native',
  enabled: true, status: 'ready', permissions: ['workspace.read'], capabilities: [], dataTargets: ['workspace'], components: ['tools'], errors: [],
  installOrigin: { pluginVersion: '1.0.0', sourceId: 'official', sourceName: 'Official', sourceKind: 'official', verified: true, publisherId: 'publisher:acme' }
}
const entry: PluginMarketEntry = {
  id: 'acme.tools', name: 'Tools', version: '2.0.0', description: '', author: 'Acme', sourceId: 'official',
  sourceName: 'Official', sourceKind: 'official', verified: true, publisherId: 'publisher:acme',
  permissions: ['workspace.read'], categories: [], platforms: [], architectures: [], dataTargets: ['workspace'], components: ['tools'], installable: true
}

describe('safe plugin auto update', () => {
  it('selects only a newer release from the same known publisher and source without added permissions', () => {
    const candidates = selectSafeAutoUpdates([
      installed,
      { ...installed, id: 'added-permission' }, { ...installed, id: 'wrong-source' },
      { ...installed, id: 'unknown-publisher' }, { ...installed, id: 'changed-publisher' }
    ], [
      entry,
      { ...entry, id: 'added-permission', permissions: ['workspace.read', 'network'] },
      { ...entry, id: 'wrong-source', sourceId: 'community' },
      { ...entry, id: 'unknown-publisher', publisherId: undefined },
      { ...entry, id: 'changed-publisher', publisherId: 'publisher:other' },
      { ...entry, id: 'changed-target', dataTargets: ['all-files'] },
      { ...entry, version: '1.0.0' }
    ])

    expect(candidates).toEqual([entry])
  })

  it('requires approval instead of auto updating when declared data targets change', () => {
    const changedTarget = { ...installed, id: 'changed-target' }
    expect(selectSafeAutoUpdates([changedTarget], [
      { ...entry, id: 'changed-target', dataTargets: ['workspace', 'browser'] }
    ])).toEqual([])
  })

  it('updates candidates sequentially and reports a failed plugin without stopping later updates', async () => {
    const second = { ...entry, id: 'beta.tools' }
    const install = vi.fn(async (candidate: PluginMarketEntry) => {
      if (candidate.id === 'acme.tools') throw new Error('download failed')
    })

    await expect(runSafeAutoUpdates([entry, second], install)).resolves.toEqual({
      updated: ['beta.tools'], failed: ['acme.tools']
    })
  })

  it('never selects a locally imported plugin for marketplace auto update', () => {
    const local = {
      ...installed,
      installOrigin: {
        pluginVersion: '1.0.0', sourceId: 'local:zip', sourceName: '本地 ZIP', sourceKind: 'local' as const, verified: false
      }
    }

    expect(selectSafeAutoUpdates([local], [entry])).toEqual([])
  })
})
