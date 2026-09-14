import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/
const MAX_POLICY_BYTES = 64 * 1024

export interface PluginDeploymentPolicy { managedPluginIds: Set<string> }

export function assertPluginUninstallAllowed(managedPluginIds: ReadonlySet<string>, id: string): void {
  if (managedPluginIds.has(id)) throw new Error('此插件受部署策略管理，不能卸载，但仍可禁用')
}

/** Reads an app-deployment-owned policy. Invalid or replaceable files grant no management authority. */
export async function loadPluginDeploymentPolicy(root: string): Promise<PluginDeploymentPolicy> {
  try {
    const path = join(root, 'plugin-policy.json')
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_POLICY_BYTES) return emptyPolicy()
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyPolicy()
    const candidate = value as { schemaVersion?: unknown; managedPlugins?: unknown }
    if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.managedPlugins) || candidate.managedPlugins.length > 500) return emptyPolicy()
    return {
      managedPluginIds: new Set(candidate.managedPlugins.filter((id): id is string => typeof id === 'string' && ID_PATTERN.test(id)))
    }
  } catch { return emptyPolicy() }
}

function emptyPolicy(): PluginDeploymentPolicy { return { managedPluginIds: new Set() } }
