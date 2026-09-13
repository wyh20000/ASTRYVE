import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PluginMarketOrigin } from '../../../shared/types'
import {
  backupPluginMarketOrigin, loadPluginMarketOrigins, restorePluginMarketOrigin, savePluginMarketOrigin
} from './pluginProvenance'

const origin = (sourceId: string): PluginMarketOrigin => ({
  pluginVersion: '1.0.0', sourceId, sourceName: sourceId, sourceKind: 'community', verified: false, publisherId: `publisher:${sourceId}`
})

describe('plugin market provenance', () => {
  it('serializes concurrent origin updates without losing another plugin record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-origins-concurrent-'))
    await Promise.all([
      savePluginMarketOrigin(root, 'acme.one', origin('one')),
      savePluginMarketOrigin(root, 'acme.two', origin('two'))
    ])
    expect(await loadPluginMarketOrigins(root)).toEqual({ 'acme.one': origin('one'), 'acme.two': origin('two') })
  })

  it('restores the exact publisher provenance alongside a rollback version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-origins-rollback-'))
    await savePluginMarketOrigin(root, 'acme.tools', origin('old'))
    await backupPluginMarketOrigin(root, 'acme.tools', '1.0.0')
    await savePluginMarketOrigin(root, 'acme.tools', origin('new'))
    await expect(restorePluginMarketOrigin(root, 'acme.tools', '1.0.0')).resolves.toEqual(origin('old'))
    expect((await loadPluginMarketOrigins(root))['acme.tools']).toEqual(origin('old'))
  })
})
