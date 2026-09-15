import { join } from 'node:path'
import { PluginConnectionManager, type PluginMcpClientFactory } from './pluginConnectionManager'
import { PluginConnectionStore } from './pluginConnectionStore'
import { PluginCredentialVault } from './pluginCredentials'
import { getInstalledPluginRoot, listPlugins } from './pluginManager'
import { readPluginManifest } from './pluginManifest'
import { readPluginMcpDeclarations } from './pluginMcpManifest'
import { PluginConnectionService } from './pluginConnectionService'
import { authorizeMcpConnection } from './pluginOAuth'

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

export function createInstalledPluginConnectionService(
  userDataPath: string,
  manager: PluginConnectionManager,
  openExternal: (url: string) => Promise<void>,
  audit?: ConstructorParameters<typeof PluginConnectionService>[0]['audit']
): PluginConnectionService {
  const store = new PluginConnectionStore(userDataPath)
  const vault = new PluginCredentialVault(userDataPath)
  return new PluginConnectionService({
    store, vault, manager, listPlugins, audit,
    resolveDeclarations: resolveInstalledPluginMcpDeclarations,
    authorizeOAuth: async ({ connectionId, declaration }) => {
      await authorizeMcpConnection({
        connectionId, resourceUrl: declaration.url, clientId: declaration.oauthClientId,
        scopes: declaration.oauthScopes, fetch, openExternal, vault
      })
    }
  })
}

export async function resolveInstalledPluginMcpDeclarations(pluginId: string) {
  const pluginRoot = join(getInstalledPluginRoot(), pluginId)
  const manifest = await readPluginManifest(pluginRoot)
  if (manifest.id !== pluginId || !manifest.mcpPath) return []
  return readPluginMcpDeclarations(pluginRoot, manifest.mcpPath)
}
