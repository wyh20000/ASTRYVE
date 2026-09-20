import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { readInstalledPluginUi } from './pluginUiContent'
import { pluginUiWebPreferences, wrapPluginUiHtml } from './pluginUiSecurity'

interface PluginUiIdentity { id: string; name: string; version?: string }
const windows = new Map<string, BrowserWindow>()
const identities = new Map<number, PluginUiIdentity>()
let bridgeRegistered = false

function trustedIdentity(event: IpcMainEvent | IpcMainInvokeEvent): PluginUiIdentity | undefined {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return undefined
  return identities.get(event.sender.id)
}

export function registerPluginUiBridge(): void {
  if (bridgeRegistered) return
  bridgeRegistered = true
  ipcMain.handle('plugin-ui:info', (event) => {
    const identity = trustedIdentity(event)
    if (!identity) throw new Error('插件界面来源无效')
    return { ...identity }
  })
  ipcMain.on('plugin-ui:close', (event) => {
    if (!trustedIdentity(event)) return
    BrowserWindow.fromWebContents(event.sender)?.destroy()
  })
}

export async function openPluginUi(installedRoot: string, id: string, parent?: BrowserWindow): Promise<BrowserWindow> {
  const existing = windows.get(id)
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return existing }
  const { name, version, html } = await readInstalledPluginUi(installedRoot, id)
  const win = new BrowserWindow({
    width: 860, height: 640, minWidth: 480, minHeight: 360,
    show: false, autoHideMenuBar: true, backgroundColor: '#171b25',
    title: `插件界面 · ${name}`, parent,
    webPreferences: pluginUiWebPreferences(join(__dirname, '../preload/pluginUi.js'), `plugin-ui-${randomUUID()}`)
  })
  windows.set(id, win)
  const webContentsId = win.webContents.id
  identities.set(webContentsId, { id, name, version })
  const uiSession = win.webContents.session
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show() })
  win.on('closed', () => {
    if (windows.get(id) === win) windows.delete(id)
    identities.delete(webContentsId)
    uiSession.removeListener('will-download', denyDownload)
  })
  win.webContents.on('page-title-updated', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-redirect', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.on('render-process-gone', () => { if (!win.isDestroyed()) win.destroy() })
  uiSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  uiSession.setPermissionCheckHandler(() => false)
  uiSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file://*/*'] }, (_details, callback) => {
    callback({ cancel: true })
  })
  uiSession.on('will-download', denyDownload)
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(wrapPluginUiHtml(html))}`)
  } catch (error) {
    if (!win.isDestroyed()) win.destroy()
    throw error
  }
  return win
}

function denyDownload(event: Electron.Event): void { event.preventDefault() }

export function closePluginUi(id: string): void {
  const win = windows.get(id)
  if (win && !win.isDestroyed()) win.destroy()
}
