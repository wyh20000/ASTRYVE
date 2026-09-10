import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { browserStatus, clearBrowserProfile, listBrowserTabs, restartBrowser, startBrowser, stopBrowser } from '../services/browser/browserManager'
import { assertTrustedIpcSender } from './validation'
import { err, ok } from './result'

export function registerBrowserIpc(): void {
  ipcMain.handle(IPC.browser.status, (event) => browserResult(event, async () => browserStatus()))
  ipcMain.handle(IPC.browser.start, (event) => browserResult(event, startBrowser))
  ipcMain.handle(IPC.browser.stop, (event) => browserResult(event, async () => stopBrowser()))
  ipcMain.handle(IPC.browser.restart, (event) => browserResult(event, restartBrowser))
  ipcMain.handle(IPC.browser.clearProfile, (event) => browserResult(event, clearBrowserProfile))
  ipcMain.handle(IPC.browser.listTabs, (event) => browserResult(event, listBrowserTabs))
}
async function browserResult(event: Electron.IpcMainInvokeEvent, action: () => Promise<unknown>) {
  try { assertTrustedIpcSender(event); return ok(await action()) }
  catch (error) { return err('BROWSER_ERR', error instanceof Error ? error.message : '浏览器操作失败') }
}
