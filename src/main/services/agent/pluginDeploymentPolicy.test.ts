import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertPluginUninstallAllowed, loadPluginDeploymentPolicy } from './pluginDeploymentPolicy'

describe('plugin deployment policy', () => {
  it('loads a bounded deployment-owned managed plugin list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-policy-'))
    await writeFile(join(root, 'plugin-policy.json'), JSON.stringify({
      schemaVersion: 1, managedPlugins: ['acme.tools', 'acme.tools', '../escape']
    }))
    await expect(loadPluginDeploymentPolicy(root)).resolves.toEqual({ managedPluginIds: new Set(['acme.tools']) })
  })

  it('fails closed to no managed plugins for a non-regular policy path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-policy-link-'))
    await mkdir(join(root, 'plugin-policy.json'))
    await expect(loadPluginDeploymentPolicy(root)).resolves.toEqual({ managedPluginIds: new Set() })
  })

  it('blocks uninstall but not disabling for a deployment-managed plugin', () => {
    expect(() => assertPluginUninstallAllowed(new Set(['acme.tools']), 'acme.tools')).toThrow('受部署策略管理')
    expect(() => assertPluginUninstallAllowed(new Set(['acme.tools']), 'other.tools')).not.toThrow()
  })
})
