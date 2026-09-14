import { join } from 'node:path'
import { PluginConnectionManager, type PluginMcpClientFactory } from './pluginConnectionManager'
import { PluginConnectionStore } from './pluginConnectionStore'
import { PluginCredentialVault } from './pluginCredentials'
import { getInstalledPluginRoot } from './pluginManager'
import { readPluginManifest } from './pluginManifest'
import { readPluginMcpDeclarations } from './pluginMcpManifest'

export function createInstalledPluginConnectionManager(
  userDataPath: string,
  createClient?: PluginMcpClientFactory
): PluginConnectionManager {
  return new PluginConnectionManager({
    store: new PluginConnectionStore(userDataPath),
    vault: new PluginCredentialVault(userDataPath),
    createClient,
    resolveDeclaration: async (pluginId, serverId) => {
      const pluginRoot = join(getInstalledPluginRoot(), pluginId)
      const manifest = await readPluginManifest(pluginRoot)
      if (manifest.id !== pluginId || !manifest.mcpPath) return undefined
      const declarations = await readPluginMcpDeclarations(pluginRoot, manifest.mcpPath)
      return declarations.find((declaration) => declaration.id === serverId)
    }
  })
}
