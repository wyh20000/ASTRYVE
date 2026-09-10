import { describe, expect, it } from 'vitest'
import { PluginRuntimeRegistry } from './pluginRuntimeRegistry'

class Runtime {
  readonly reasons: string[] = []
  async stop(reason: string): Promise<void> { this.reasons.push(reason) }
}

describe('PluginRuntimeRegistry', () => {
  it('stops every runtime for the uninstalled plugin without stopping other plugins', async () => {
    const registry = new PluginRuntimeRegistry()
    const first = new Runtime()
    const second = new Runtime()
    const unrelated = new Runtime()
    registry.add('acme.tools', first)
    registry.add('acme.tools', second)
    registry.add('other.tools', unrelated)

    await registry.stopAll('acme.tools', 'plugin_uninstalled')
    await registry.stopAll('acme.tools', 'plugin_uninstalled')

    expect(first.reasons).toEqual(['plugin_uninstalled'])
    expect(second.reasons).toEqual(['plugin_uninstalled'])
    expect(unrelated.reasons).toEqual([])
  })
})
