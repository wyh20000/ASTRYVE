import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { initStore } from './db'
import { initModelConfig } from './services/modelConfig'
import { initSettings } from './services/settings'
import { registerIpcHandlers } from './ipc'

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
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await initStore()
  initModelConfig()
  initSettings()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
