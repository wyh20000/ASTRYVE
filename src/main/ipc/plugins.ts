import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { EVENTS, IPC } from '@shared/ipc'
import type { PluginImportInput, PluginMarketInstallInput, PluginMarketOrigin, PluginMarketSourceIdInput, PluginMarketSourceInput, PluginMarketSourceToggleInput, PluginMetadata, PluginRecoverInput, PluginRollbackInput, PluginToggleInput, PluginUninstallInput } from '@shared/types'
import { getInstalledPluginRoot, listPlugins, recoverPlugin, stopPluginRuntimes } from '../services/agent/pluginManager'
import { importPluginPackage } from '../services/agent/pluginInstaller'
import { setPluginEnabled } from '../services/settings'
import { assertTrustedIpcSender } from './validation'
import { err, ok } from './result'
import { PluginMarketplace } from '../services/agent/pluginMarketplace'
import { installMarketPlugin, listPluginBackups, rollbackPlugin } from '../services/agent/pluginLifecycle'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { replacePluginMarketOrigin, savePluginMarketOrigin } from '../services/agent/pluginProvenance'
import { writeAgentAudit } from '../services/agent/taskRuntimeManager'
import { auditPluginOperation } from '../services/agent/pluginAudit'

export function registerPluginsIpc(): void {
  const marketplace = new PluginMarketplace(app.getPath('userData'))
  ipcMain.handle(IPC.plugins.list, async (event) => {
    try {
      assertTrustedIpcSender(event)
      return ok(await listPlugins())
    } catch (error) {
      return err('PLUGIN_LIST_ERR', error instanceof Error ? error.message : '插件加载失败')
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
      let preparedId: string | undefined
      let previousOrigin: PluginMarketOrigin | undefined
      let prepared = false
      let installed: PluginMetadata
      try {
        installed = await importPluginPackage(getInstalledPluginRoot(), selected.filePaths[0], { beforeReplace: async (manifest) => {
          setPluginEnabled(manifest.id, false)
          previousOrigin = await replacePluginMarketOrigin(app.getPath('userData'), manifest.id)
          preparedId = manifest.id
          prepared = true
        } })
      } catch (error) {
        if (prepared && preparedId) await replacePluginMarketOrigin(app.getPath('userData'), preparedId, previousOrigin).catch(() => undefined)
        throw error
      }
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
        (id) => setPluginEnabled(id, false)
      )
      setPluginEnabled(installed.id, false)
      notifyPluginsChanged()
      return listPlugins()
    })
  }))
  ipcMain.handle(IPC.plugins.uninstall, async (event, input?: PluginUninstallInput) => marketResult(event, async () => {
    if (!input || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(input.id)) throw new Error('插件标识无效')
    const current = (await listPlugins()).find((plugin) => plugin.id === input.id)
    return auditPluginOperation(writeAgentAudit, {
      action: 'plugin.uninstall', pluginId: input.id, pluginVersion: current?.version
    }, async () => {
      setPluginEnabled(input.id, false)
      await stopPluginRuntimes(input.id)
      await rm(join(getInstalledPluginRoot(), input.id), { recursive: true, force: true })
      await savePluginMarketOrigin(app.getPath('userData'), input.id)
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
      const restored = await rollbackPlugin(input.id, input.version, app.getPath('userData'), getInstalledPluginRoot())
      setPluginEnabled(restored.id, false)
      notifyPluginsChanged()
      return listPlugins()
    })
  }))
}

async function marketResult(event: Electron.IpcMainInvokeEvent, action: () => Promise<unknown>) {
  try { assertTrustedIpcSender(event); return ok(await action()) }
  catch (error) { return err('PLUGIN_MARKET_ERR', error instanceof Error ? error.message : '插件市场操作失败') }
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

function notifyPluginsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(EVENTS.pluginsChanged)
  }
}
