import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PluginInstallOrigin } from '../../../shared/types'
import {
  backupPluginInstallOrigin, createLocalInstallOrigin, loadPluginInstallOrigins,
  restorePluginInstallOrigin, savePluginInstallOrigin
} from './pluginProvenance'

const origin = (sourceId: string): PluginInstallOrigin => ({
  pluginVersion: '1.0.0', sourceId, sourceName: sourceId, sourceKind: 'community', verified: false, publisherId: `publisher:${sourceId}`
})

describe('plugin install provenance', () => {
  it('serializes concurrent origin updates without losing another plugin record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-origins-concurrent-'))
    await Promise.all([
      savePluginInstallOrigin(root, 'acme.one', origin('one')),
      savePluginInstallOrigin(root, 'acme.two', origin('two'))
    ])
    expect(await loadPluginInstallOrigins(root)).toEqual({ 'acme.one': origin('one'), 'acme.two': origin('two') })
  })

  it('restores the exact publisher provenance alongside a rollback version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-origins-rollback-'))
    await savePluginInstallOrigin(root, 'acme.tools', origin('old'))
    await backupPluginInstallOrigin(root, 'acme.tools', '1.0.0')
    await savePluginInstallOrigin(root, 'acme.tools', origin('new'))
    await expect(restorePluginInstallOrigin(root, 'acme.tools', '1.0.0')).resolves.toEqual(origin('old'))
    expect((await loadPluginInstallOrigins(root))['acme.tools']).toEqual(origin('old'))
  })

  it('loads existing schema v1 marketplace records into the unified model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-origins-legacy-'))
    await writeFile(join(root, 'plugin-origins.json'), JSON.stringify({
      schemaVersion: 1,
      origins: { 'acme.tools': origin('legacy-market') }
    }))

    expect((await loadPluginInstallOrigins(root))['acme.tools']).toEqual(origin('legacy-market'))
  })

  it('describes local imports without a filesystem path field', () => {
    const local = createLocalInstallOrigin('1.2.3', 'zip')

    expect(local).toEqual({
      pluginVersion: '1.2.3', sourceId: 'local:zip', sourceName: '本地 ZIP', sourceKind: 'local', verified: false
    })
  })
})
