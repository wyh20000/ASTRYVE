import { createHash, randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { EVENTS, IPC } from '@shared/ipc'
import type { PluginImportInput, PluginMarketInstallInput, PluginMarketSourceIdInput, PluginMarketSourceInput, PluginMarketSourceToggleInput, PluginMetadata, PluginPreferences, PluginRecoverInput, PluginRollbackInput, PluginToggleInput, PluginUninstallInput, PluginMcpConnectInput, PluginMcpTargetInput, PluginMcpDisconnectInput } from '@shared/types'
import { getInstalledPluginRoot, listPlugins, recoverPlugin, stopPluginRuntimes } from '../services/agent/pluginManager'
import { getPluginPreferences, setPluginEnabled, setPluginPreferences } from '../services/settings'
import { assertTrustedIpcSender } from './validation'
import { err, ok } from './result'
import { PluginMarketplace } from '../services/agent/pluginMarketplace'
import { installLocalPlugin, installMarketPlugin, listPluginBackups, rollbackPlugin } from '../services/agent/pluginLifecycle'
import { savePluginInstallOrigin } from '../services/agent/pluginProvenance'
import { writeAgentAudit } from '../services/agent/taskRuntimeManager'
import { auditPluginOperation } from '../services/agent/pluginAudit'
import { runSafeAutoUpdates, selectSafeAutoUpdates } from '../services/agent/pluginAutoUpdate'
import { assertPluginUninstallAllowed } from '../services/agent/pluginDeploymentPolicy'
import { uninstallPlugin } from '../services/agent/pluginUninstall'
import { removePluginConnectionData } from '../services/agent/pluginCredentials'
import { createInstalledPluginConnectionService } from '../services/agent/pluginMcpRuntime'
import { getPluginConnectionManager } from '../services/agent/taskRuntimeManager'
import { listPluginSkills } from '../services/agent/skillManager'
import { readPluginAsset, readPluginIcon } from '../services/agent/pluginAssets'
import { closePluginUi, openPluginUi, registerPluginUiBridge } from '../services/agent/pluginUiWindow'

export function registerPluginsIpc(): void {
  registerPluginUiBridge()
  const marketplace = new PluginMarketplace(app.getPath('userData'))
  const connectionService = createInstalledPluginConnectionService(
    app.getPath('userData'), getPluginConnectionManager(), (url) => shell.openExternal(url),
    (connectionEvent) => writeAgentAudit({
      id: randomUUID(), timestamp: Date.now(), taskId: 'plugin-connections', workspaceId: 'none', actor: 'user',
      action: connectionEvent.action, outcome: connectionEvent.outcome, pluginId: connectionEvent.pluginId,
      target: connectionEvent.connectionId
        ? `sha256:${createHash('sha256').update(connectionEvent.connectionId).digest('hex')}`
        : undefined
    })
  )
  let autoUpdateRun: Promise<void> | undefined
  const scheduleAutoUpdate = (): void => {
    if (!getPluginPreferences().autoUpdate || autoUpdateRun) return
    autoUpdateRun = runAutomaticUpdates(marketplace).finally(() => { autoUpdateRun = undefined })
    void autoUpdateRun.catch((error) => console.warn('[plugins] automatic update failed:', error))
  }
  scheduleAutoUpdate()
  ipcMain.handle(IPC.plugins.list, async (event) => {
    try {
      assertTrustedIpcSender(event)
      return ok(await listPlugins())
    } catch (error) {
      return err('PLUGIN_LIST_ERR', error instanceof Error ? error.message : '插件加载失败')
    }
  })

  ipcMain.handle(IPC.plugins.readIcon, async (event, input?: { id: string }) => {
    try {
      assertTrustedIpcSender(event)
      assertPluginId(input)
      return ok(await readPluginIcon(getInstalledPluginRoot(), input.id))
    } catch (error) {
      return err('PLUGIN_ICON_ERR', error instanceof Error ? error.message : '插件图标读取失败')
    }
  })

  ipcMain.handle(IPC.plugins.readAsset, async (event, input?: { id: string; path: string }) => {
    try {
      assertTrustedIpcSender(event)
      assertPluginId(input)
      if (typeof input.path !== 'string') return err('INVALID_INPUT', '插件静态资源路径无效')
      return ok(await readPluginAsset(getInstalledPluginRoot(), input.id, input.path))
    } catch (error) {
      return err('PLUGIN_ASSET_ERR', error instanceof Error ? error.message : '插件静态资源读取失败')
    }
  })

  ipcMain.handle(IPC.plugins.openUi, async (event, input?: { id: string }) => {
    try {
      assertTrustedIpcSender(event)
      assertPluginId(input)
      const plugin = (await listPlugins()).find((item) => item.id === input.id)
      if (!plugin || plugin.status !== 'ready' || !plugin.enabled || !plugin.components.includes('ui')) {
        return err('PLUGIN_UI_UNAVAILABLE', '插件界面不可用，请确认插件已启用')
      }
      await openPluginUi(getInstalledPluginRoot(), input.id, BrowserWindow.fromWebContents(event.sender) ?? undefined)
      return ok(undefined)
    } catch (error) {
      return err('PLUGIN_UI_ERR', error instanceof Error ? error.message : '插件界面打开失败')
    }
  })

  ipcMain.handle(IPC.plugins.listSkills, async (event, input?: PluginUninstallInput) => {
    try {
      assertTrustedIpcSender(event)
      assertPluginId(input)
      return ok(await listPluginSkills(input.id))
    } catch (error) {
      return err('PLUGIN_SKILLS_ERR', error instanceof Error ? error.message : '插件技能加载失败')
    }
  })

  ipcMain.handle(IPC.plugins.importLocal, async (event, input?: PluginImportInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || (input.kind !== 'directory' && input.kind !== 'zip')) return err('INVALID_INPUT', '插件导入类型无效')
      const selected = await dialog.showOpenDialog({
        title: input.kind === 'directory' ? '选择插件文件夹' : '选择插件 ZIP 文件',
        properties: input.kind === 'directory' ? ['openDirectory'] : ['openFile'],
        filters: input.kind === 'zip' ? [{ name: '插件 ZIP', extensions: ['zip'] }] : undefined
      })
      if (selected.canceled || !selected.filePaths[0]) return ok(await listPlugins())
      const installed = await installLocalPlugin(
        selected.filePaths[0], input.kind, app.getPath('userData'), getInstalledPluginRoot(),
        (id) => { closePluginUi(id); setPluginEnabled(id, false) }
      )
      // Local packages may contain executable code. Importing makes the package
      // available for inspection, but activation remains an explicit user choice.
      setPluginEnabled(installed.id, false)
      notifyPluginsChanged()
      return ok(await listPlugins())
    } catch (error) {
      return err('PLUGIN_IMPORT_ERR', error instanceof Error ? error.message : '插件导入失败')
    }
  })

  ipcMain.handle(IPC.plugins.setEnabled, async (event, input?: PluginToggleInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input.enabled !== 'boolean' || typeof input.id !== 'string' ||
          !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(input.id)) return err('INVALID_INPUT', '插件设置无效')
      const current = await listPlugins()
      const target = current.find((plugin) => plugin.id === input.id)
      if (!target) return err('NOT_FOUND', '插件不存在')
      if (target.status !== 'ready') return err('INVALID_PLUGIN', '无效插件不能启用')
      if (!input.enabled) closePluginUi(input.id)
      setPluginEnabled(input.id, input.enabled)
      notifyPluginsChanged()
      return ok(await listPlugins())
    } catch (error) {
      return err('PLUGIN_SET_ERR', error instanceof Error ? error.message : '插件设置保存失败')
    }
  })

  ipcMain.handle(IPC.plugins.recover, async (event, input?: PluginRecoverInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(input.id)) {
        return err('INVALID_INPUT', '插件恢复参数无效')
      }
      recoverPlugin(input.id)
      notifyPluginsChanged()
      return ok(await listPlugins())
    } catch (error) {
      return err('PLUGIN_RECOVER_ERR', error instanceof Error ? error.message : '插件恢复失败')
    }
  })

  ipcMain.handle(IPC.plugins.getPreferences, (event) => {
    try { assertTrustedIpcSender(event); return ok(getPluginPreferences()) }
    catch (error) { return err('PLUGIN_SET_ERR', error instanceof Error ? error.message : '插件设置读取失败') }
  })
  ipcMain.handle(IPC.plugins.setPreferences, (event, input?: PluginPreferences) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input.autoUpdate !== 'boolean') return err('INVALID_INPUT', '插件设置无效')
      const saved = setPluginPreferences(input)
      if (saved.autoUpdate) scheduleAutoUpdate()
      return ok(saved)
    } catch (error) { return err('PLUGIN_SET_ERR', error instanceof Error ? error.message : '插件设置保存失败') }
  })

  ipcMain.handle(IPC.plugins.marketplace, async (event) => marketResult(event, () => marketplace.snapshot()))
  ipcMain.handle(IPC.plugins.addSource, async (event, input?: PluginMarketSourceInput) => marketResult(event, async () => {
    if (!input || typeof input.name !== 'string' || typeof input.url !== 'string') throw new Error('市场源参数无效')
    await marketplace.addSource(input)
    return marketplace.snapshot()
  }))
  ipcMain.handle(IPC.plugins.setSourceEnabled, async (event, input?: PluginMarketSourceToggleInput) => marketResult(event, () => {
    assertSourceToggle(input)
    return marketplace.setSourceEnabled(input.id, input.enabled)
  }))
  ipcMain.handle(IPC.plugins.removeSource, async (event, input?: PluginMarketSourceIdInput) => marketResult(event, () => {
    assertSourceId(input)
    return marketplace.removeSource(input.id)
  }))
  ipcMain.handle(IPC.plugins.syncSource, async (event, input?: PluginMarketSourceIdInput) => marketResult(event, () => {
    assertSourceId(input)
    return marketplace.syncSource(input.id)
  }))
  ipcMain.handle(IPC.plugins.installMarket, async (event, input?: PluginMarketInstallInput) => marketResult(event, async () => {
    if (!input || typeof input.sourceId !== 'string' || typeof input.id !== 'string' || typeof input.version !== 'string') throw new Error('插件安装参数无效')
    const snapshot = await marketplace.snapshot()
    const entry = snapshot.entries.find((item) => item.sourceId === input.sourceId && item.id === input.id && item.version === input.version)
    if (!entry) throw new Error('市场插件版本不存在，请先同步市场源')
    const current = (await listPlugins()).find((plugin) => plugin.id === entry.id)
    return auditPluginOperation(writeAgentAudit, {
      action: current ? 'plugin.update' : 'plugin.install', pluginId: entry.id, pluginVersion: entry.version
    }, async () => {
      const installed = await installMarketPlugin(
        entry, app.getPath('userData'), getInstalledPluginRoot(), fetch,
        (id) => { closePluginUi(id); setPluginEnabled(id, false) }
      )
      setPluginEnabled(installed.id, false)
      notifyPluginsChanged()
      return listPlugins()
    })
  }))
  ipcMain.handle(IPC.plugins.uninstall, async (event, input?: PluginUninstallInput) => marketResult(event, async () => {
    if (!input || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(input.id)) throw new Error('插件标识无效')
    const current = (await listPlugins()).find((plugin) => plugin.id === input.id)
    assertPluginUninstallAllowed(new Set(current?.managed ? [input.id] : []), input.id)
    return auditPluginOperation(writeAgentAudit, {
      action: 'plugin.uninstall', pluginId: input.id, pluginVersion: current?.version
    }, async () => {
      setPluginEnabled(input.id, false)
      closePluginUi(input.id)
      await uninstallPlugin(input.id, input.dataDisposition ?? 'keep', app.getPath('userData'), getInstalledPluginRoot(), {
        stop: stopPluginRuntimes,
        disposeConnections: (id, disposition) => removePluginConnectionData(id, disposition, app.getPath('userData'))
      })
      await savePluginInstallOrigin(app.getPath('userData'), input.id)
      notifyPluginsChanged()
      return listPlugins()
    })
  }))
  ipcMain.handle(IPC.plugins.backups, async (event, input?: PluginUninstallInput) => marketResult(event, async () => {
    assertPluginId(input)
    return listPluginBackups(input.id, app.getPath('userData'))
  }))
  ipcMain.handle(IPC.plugins.rollback, async (event, input?: PluginRollbackInput) => marketResult(event, async () => {
    assertPluginId(input)
    if (typeof input.version !== 'string') throw new Error('回滚版本无效')
    return auditPluginOperation(writeAgentAudit, {
      action: 'plugin.rollback', pluginId: input.id, pluginVersion: input.version
    }, async () => {
      setPluginEnabled(input.id, false)
      closePluginUi(input.id)
      const restored = await rollbackPlugin(input.id, input.version, app.getPath('userData'), getInstalledPluginRoot())
      setPluginEnabled(restored.id, false)
      notifyPluginsChanged()
      return listPlugins()
    })
  }))
  ipcMain.handle(IPC.plugins.listConnections, async (event) => connectionResult(event, () => connectionService.list()))
  ipcMain.handle(IPC.plugins.connectMcp, async (event, input?: PluginMcpConnectInput) => connectionResult(event, () => {
    assertConnectInput(input)
    return notifyAfter(connectionService.connect(input))
  }))
  ipcMain.handle(IPC.plugins.reauthorizeMcp, async (event, input?: PluginMcpConnectInput) => connectionResult(event, () => {
    assertConnectInput(input)
    return notifyAfter(connectionService.reauthorize(input))
  }))
  ipcMain.handle(IPC.plugins.retryMcp, async (event, input?: PluginMcpTargetInput) => connectionResult(event, () => {
    assertMcpTarget(input)
    return notifyAfter(connectionService.retry(input))
  }))
  ipcMain.handle(IPC.plugins.disconnectMcp, async (event, input?: PluginMcpDisconnectInput) => connectionResult(event, () => {
    if (!input || typeof input.connectionId !== 'string') throw new Error('MCP 连接标识无效')
    return notifyAfter(connectionService.disconnect(input))
  }))
}

async function runAutomaticUpdates(marketplace: PluginMarketplace): Promise<void> {
  const [snapshot, installed] = await Promise.all([marketplace.snapshot(), listPlugins()])
  const candidates = selectSafeAutoUpdates(installed, snapshot.entries)
  const byId = new Map(installed.map((plugin) => [plugin.id, plugin]))
  const result = await runSafeAutoUpdates(candidates, async (entry) => {
    const previous = byId.get(entry.id)
    const wasEnabled = previous?.enabled === true
    try {
      await auditPluginOperation(writeAgentAudit, {
        action: 'plugin.update', pluginId: entry.id, pluginVersion: entry.version
      }, async () => {
        await stopPluginRuntimes(entry.id)
        closePluginUi(entry.id)
        await installMarketPlugin(entry, app.getPath('userData'), getInstalledPluginRoot(), fetch, (id) => setPluginEnabled(id, false))
      })
    } finally {
      if (wasEnabled) setPluginEnabled(entry.id, true)
    }
  })
  if (result.updated.length) notifyPluginsChanged()
  if (result.failed.length) console.warn('[plugins] safe automatic updates failed:', result.failed.join(', '))
}

async function marketResult(event: Electron.IpcMainInvokeEvent, action: () => Promise<unknown>) {
  try { assertTrustedIpcSender(event); return ok(await action()) }
  catch (error) { return err('PLUGIN_MARKET_ERR', error instanceof Error ? error.message : '插件市场操作失败') }
}
async function connectionResult(event: Electron.IpcMainInvokeEvent, action: () => Promise<unknown>) {
  try { assertTrustedIpcSender(event); return ok(await action()) }
  catch (error) { return err('PLUGIN_MCP_ERR', error instanceof Error ? error.message : '插件连接操作失败') }
}
function assertMcpTarget(input?: PluginMcpTargetInput): asserts input is PluginMcpTargetInput {
  if (!input || typeof input.pluginId !== 'string' || typeof input.serverId !== 'string') throw new Error('MCP 连接参数无效')
}
function assertConnectInput(input?: PluginMcpConnectInput): asserts input is PluginMcpConnectInput {
  assertMcpTarget(input)
  if (input.connectionId !== undefined && typeof input.connectionId !== 'string') throw new Error('MCP 连接标识无效')
  if (input.credential !== undefined && typeof input.credential !== 'string') throw new Error('MCP 凭据无效')
  if (input.accountLabel !== undefined && typeof input.accountLabel !== 'string') throw new Error('账号标签无效')
}
function assertSourceId(input?: PluginMarketSourceIdInput): asserts input is PluginMarketSourceIdInput {
  if (!input || typeof input.id !== 'string' || !/^source-[a-f0-9-]{36}$/.test(input.id)) throw new Error('市场源标识无效')
}
function assertSourceToggle(input?: PluginMarketSourceToggleInput): asserts input is PluginMarketSourceToggleInput {
  assertSourceId(input)
  if (typeof input.enabled !== 'boolean') throw new Error('市场源设置无效')
}
function assertPluginId(input?: { id: string }): asserts input is { id: string } {
  if (!input || typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(input.id)) throw new Error('插件标识无效')
}

async function notifyAfter<T>(operation: Promise<T>): Promise<T> {
  const result = await operation
  notifyPluginsChanged()
  return result
}

function notifyPluginsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(EVENTS.pluginsChanged)
  }
}
