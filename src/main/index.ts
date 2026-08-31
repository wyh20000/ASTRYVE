import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { initStore } from './db'
import { initModelConfig } from './services/modelConfig'
import { initSettings } from './services/settings'
import { registerIpcHandlers } from './ipc'
import {
  cancelAllGenerations,
  cancelGenerationsForWebContents
} from './services/generationTasks'

const isDev = !app.isPackaged

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: '#0a0e17',
    // 用自定义隐藏标题栏 + 覆盖层（仅 Windows），让顶部随主题颜色变化
    titleBarStyle: process.platform === 'win32' ? 'hidden' : undefined,
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: '#0a0e17', symbolColor: '#a7b0c0', height: 32 }
        : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 暂留：后续 coding 能力先完成主进程/utilityProcess 权限边界后再启用 renderer sandbox。
      sandbox: false
    }
  })

  // 窗口创建即显示；就绪后置顶聚焦，确保弹到最前
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
    win.moveTop()
  })

  win.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:') void shell.openExternal(url.toString())
      else console.warn('[security] blocked external URL protocol:', url.protocol)
    } catch {
      console.warn('[security] blocked malformed external URL')
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl !== win.webContents.getURL()) event.preventDefault()
  })
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  win.webContents.session.setPermissionCheckHandler(() => false)
  const webContentsId = win.webContents.id
  win.webContents.once('destroyed', () => cancelGenerationsForWebContents(webContentsId))

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  initSettings()
  await initStore()
  initModelConfig()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => cancelAllGenerations())
