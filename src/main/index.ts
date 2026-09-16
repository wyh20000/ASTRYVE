import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { getStore, initStore } from './db'
import { initModelConfig } from './services/modelConfig'
import { initSettings } from './services/settings'
import { registerIpcHandlers } from './ipc'
import { FIRST_PAINT_BACKGROUND, FIRST_PAINT_SYMBOL } from '@shared/themePaint'
import { initWorkspaceService } from './services/agent/workspaceManager'
import {
  cancelAllAgentTasks,
  cancelTasksForOwner,
  flushTaskPersistence,
  initTaskPersistence,
  initTaskRuntime
} from './services/agent/taskRuntimeManager'
import {
  cancelAllGenerations,
  cancelGenerationsForWebContents
} from './services/generationTasks'
import { refreshAgentExecutionCapabilities } from './services/agent/projectPreferences'
import { cleanupInterruptedDockerResources, startDockerCleanupTimer } from './services/agent/dockerCleanup'
import { cleanupEmptySessions } from './services/emptySessionCleanup'
import { initSkillRegistry } from './services/agent/skillManager'
import { initPluginRegistry } from './services/agent/pluginManager'
import { configureTrustedIpcSender } from './ipc/validation'
import {
  createSecureWebPreferences,
  isAllowedExternalUrl,
  isAllowedRendererNavigation
} from './windowSecurity'

const isDev = !app.isPackaged
const rendererEntry = isDev && process.env['ELECTRON_RENDERER_URL']
  ? process.env['ELECTRON_RENDERER_URL']
  : pathToFileURL(join(__dirname, '../renderer/index.html')).toString()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    autoHideMenuBar: true,
    // 首帧兜底：渲染进程应用主题前的底色（跟随深色基线，避免闪旧版深蓝）
    backgroundColor: FIRST_PAINT_BACKGROUND,
    // 用自定义隐藏标题栏 + 覆盖层（仅 Windows），让顶部随主题颜色变化
    titleBarStyle: process.platform === 'win32' ? 'hidden' : undefined,
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: FIRST_PAINT_BACKGROUND, symbolColor: FIRST_PAINT_SYMBOL, height: 32 }
        : undefined,
    webPreferences: createSecureWebPreferences(join(__dirname, '../preload/index.js'))
  })

  // 窗口创建即显示；就绪后置顶聚焦，确保弹到最前
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
    win.moveTop()
  })

  win.webContents.setWindowOpenHandler((details) => {
    try {
      if (isAllowedExternalUrl(details.url)) void shell.openExternal(details.url)
      else console.warn('[security] blocked external URL')
    } catch {
      console.warn('[security] blocked malformed external URL')
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedRendererNavigation(win.webContents.getURL(), navigationUrl)) event.preventDefault()
  })
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  win.webContents.session.setPermissionCheckHandler(() => false)
  const webContentsId = win.webContents.id
  win.webContents.once('destroyed', () => {
    cancelGenerationsForWebContents(webContentsId)
    cancelTasksForOwner(webContentsId, 'window_closed')
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(rendererEntry)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  if (process.env.AI_AGENT_PLUGIN_SMOKE === '1') {
    try {
      const { runPluginRuntimeSmoke } = await import('./services/agent/pluginRuntimeSmoke')
      await runPluginRuntimeSmoke()
      console.log('PASS: market download, validation, install, task capture, isolated worker invocation and stop')
      app.exit(0)
    } catch (error) {
      console.error('FAIL: market plugin runtime smoke', error)
      app.exit(1)
    }
    return
  }
  if (process.env.AI_AGENT_DOCKER_EXECUTION_SMOKE === '1') {
    try {
      const { runDockerExecutionSmoke } = await import('./services/agent/dockerExecutionSmoke')
      await runDockerExecutionSmoke()
      console.log('PASS: filtered Docker execution, secret exclusion and forced cancellation')
      app.exit(0)
    } catch (error) {
      console.error('FAIL: Docker execution smoke', error)
      app.exit(1)
    }
    return
  }
  if (process.env.AI_AGENT_LOCAL_EXECUTION_SMOKE === '1') {
    try {
      const { runLocalExecutionSmoke } = await import('./services/agent/localExecutionSmoke')
      await runLocalExecutionSmoke()
      console.log('PASS: real Electron utility execution and process-tree cancellation')
      app.exit(0)
    } catch (error) {
      console.error('FAIL: local execution smoke', error)
      app.exit(1)
    }
    return
  }
  initSettings()
  const dockerPreflight = refreshAgentExecutionCapabilities()
  try {
    const cleanup = await cleanupInterruptedDockerResources()
    if (cleanup.containersRemoved) console.log('[agent] removed interrupted Docker resources', cleanup)
  } catch (error) {
    console.warn('[agent] Docker recovery unavailable:', error)
  }
  void dockerPreflight
  startDockerCleanupTimer()
  initWorkspaceService()
  initTaskRuntime()
  initPluginRegistry(app.getPath('userData'))
  initSkillRegistry(app.getPath('userData'))
  try {
    const recovery = await initTaskPersistence(app.getPath('userData'))
    if (recovery.staleTasks || recovery.removedResources || recovery.removedInterruptedWrites) {
      console.log('[agent] runtime recovery', recovery)
    }
  } catch (error) {
    console.warn('[agent] runtime persistence unavailable:', error)
  }
  await initStore()
  try {
    const removed = await cleanupEmptySessions(getStore())
    if (removed) console.log('[session] removed empty sessions at startup:', removed)
  } catch (error) {
    console.warn('[session] startup empty-session cleanup failed:', error)
  }
  initModelConfig()
  configureTrustedIpcSender(rendererEntry)
  registerIpcHandlers()
  const mainWindow = createWindow()

  // 真实窗口主题验收：只在显式开启时运行，用于替代纯 jsdom 的假验证。
  if (process.env.AI_AGENT_THEME_SMOKE === '1') {
    try {
      const { runThemePaintSmoke } = await import('./services/themePaintSmoke')
      await runThemePaintSmoke(mainWindow)
      app.exit(0)
    } catch (error) {
      console.error('FAIL: theme paint smoke', error)
      app.exit(1)
    }
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let shutdownStarted = false
let shutdownComplete = false
app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  cancelAllGenerations()
  cancelAllAgentTasks('app_quit')
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(resolve, 2_000)
  })
  const emptySessionCleanup = Promise.resolve()
    .then(() => cleanupEmptySessions(getStore()))
    .catch((error) => {
      console.warn('[session] empty-session cleanup failed:', error)
      return 0
    })
  void Promise.race([
    Promise.all([flushTaskPersistence(), emptySessionCleanup]).then(() => undefined),
    timeout
  ])
    .catch((error) => console.warn('[agent] final task journal flush failed:', error))
    .finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      shutdownComplete = true
      app.quit()
    })
})
