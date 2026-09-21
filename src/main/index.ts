import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getStore, initStore } from './db'
import { initModelConfig } from './services/modelConfig'
import { getThemeSettings, initSettings } from './services/settings'
import { registerIpcHandlers } from './ipc'
import {
  FIRST_PAINT_BACKGROUND,
  FIRST_PAINT_LIGHT_BACKGROUND,
  FIRST_PAINT_LIGHT_SYMBOL,
  FIRST_PAINT_SYMBOL
} from '@shared/themePaint'
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
import { setBusinessIpcAvailable } from './ipc/validation'
import { registerAuthIpc } from './ipc/auth'
import { closeAllTerminals } from './ipc/terminal'
import { currentAccountPath, currentAuthStatus, initializeAuth, setDevelopmentSmokeAuth, startSessionRechecks } from './services/auth/authSession'
import {
  createSecureWebPreferences,
  isAllowedExternalUrl,
  isAllowedRendererNavigation
} from './windowSecurity'
import {
  closeOfficialChromeBrowserRuntime,
  initOfficialChromeBrowserRuntime
} from './services/browser/officialChromeBrowserRuntime'

const isDev = !app.isPackaged
// Keep the pre-rebrand storage location stable. The folder name is an internal
// compatibility key; changing the visible product name must not hide user data.
app.setPath('userData', join(app.getPath('appData'), 'ai-agent'))
app.setName('ASTRYVE')
if (isDev && process.env.AI_AGENT_AUTH_SMOKE && process.env.AI_AGENT_AUTH_SMOKE_USER_DATA) {
  app.setPath('userData', process.env.AI_AGENT_AUTH_SMOKE_USER_DATA)
}
const rendererEntry = isDev && process.env['ELECTRON_RENDERER_URL']
  ? process.env['ELECTRON_RENDERER_URL']
  : pathToFileURL(join(__dirname, '../renderer/index.html')).toString()

function createWindow(locked = false): BrowserWindow {
  const persistedTheme = getThemeSettings()
  const isDark = persistedTheme.mode === 'system'
    ? nativeTheme.shouldUseDarkColors
    : persistedTheme.mode !== 'light'
  const firstPaintBackground = persistedTheme.overrides.bg ?? (
    isDark ? FIRST_PAINT_BACKGROUND : FIRST_PAINT_LIGHT_BACKGROUND
  )
  const firstPaintSymbol = persistedTheme.overrides.text ?? (
    isDark ? FIRST_PAINT_SYMBOL : FIRST_PAINT_LIGHT_SYMBOL
  )
  const windowBackground = locked ? '#060b17' : firstPaintBackground
  const windowSymbol = locked ? '#d7e6fb' : firstPaintSymbol

  const win = new BrowserWindow({
    title: 'ASTRYVE',
    icon: isDev ? join(process.cwd(), 'build', 'icon.png') : join(process.resourcesPath, 'icon.png'),
    width: locked ? 1120 : 1440,
    height: locked ? 760 : 900,
    minWidth: locked ? 430 : 1120,
    minHeight: locked ? 560 : 720,
    autoHideMenuBar: true,
    // 首帧兜底：渲染进程应用主题前即匹配系统/持久化模式，避免明暗闪烁
    backgroundColor: windowBackground,
    // 用自定义隐藏标题栏 + 覆盖层（仅 Windows），让顶部随主题颜色变化
    titleBarStyle: process.platform === 'win32' ? 'hidden' : undefined,
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: windowBackground, symbolColor: windowSymbol, height: 36 }
        : undefined,
    webPreferences: createSecureWebPreferences(join(__dirname, '../preload/index.js'))
  })
  if (locked && process.platform === 'win32') {
    win.setTitleBarOverlay({ color: windowBackground, symbolColor: windowSymbol, height: 36 })
  }

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
  if (process.platform === 'win32') app.setAppUserModelId('com.astryve.app')
  if (isDev && process.env.AI_AGENT_PLUGIN_UI_SMOKE === '1') {
    try {
      const { runPluginUiSmoke } = await import('./services/agent/pluginUiSmoke')
      await runPluginUiSmoke()
      console.log('PASS: isolated plugin UI and minimal bridge')
      app.exit(0)
    } catch (error) {
      console.error('FAIL: isolated plugin UI smoke', error)
      app.exit(1)
    }
    return
  }
  if (isDev && process.env.AI_AGENT_PLUGIN_SMOKE === '1') {
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
  if (isDev && process.env.AI_AGENT_MARKET_ICON_SMOKE === '1') {
    try {
      const { runMarketIconDiagnostics } = await import('./services/marketIconDiagnostics')
      await runMarketIconDiagnostics()
      app.exit(0)
    } catch (error) {
      console.error('FAIL: market icon diagnostics', error)
      app.exit(1)
    }
    return
  }

  if (isDev && process.env.AI_AGENT_DOCKER_EXECUTION_SMOKE === '1') {
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
  if (isDev && process.env.AI_AGENT_LOCAL_EXECUTION_SMOKE === '1') {
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
  configureTrustedIpcSender(rendererEntry)
  registerAuthIpc()
  const themeSmoke = !app.isPackaged && process.env.AI_AGENT_THEME_SMOKE === '1'
  if (themeSmoke) setDevelopmentSmokeAuth()
  const authStatus = themeSmoke ? currentAuthStatus() : await initializeAuth(app.getPath('userData'))
  if (authStatus.state === 'authenticated') {
    if (!themeSmoke) {
      const accountPath = currentAccountPath()
      if (!accountPath) throw new Error('已验证账号缺少数据目录')
      mkdirSync(accountPath, { recursive: true })
      app.setPath('userData', accountPath)
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
    let browserGateway
    try {
      browserGateway = await initOfficialChromeBrowserRuntime()
    } catch (error) {
      console.warn('[browser] Google Chrome DevTools MCP unavailable:', error)
    }
    initTaskRuntime(browserGateway)
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
    await initStore(!themeSmoke)
    try {
      const removed = await cleanupEmptySessions(getStore())
      if (removed) console.log('[session] removed empty sessions at startup:', removed)
    } catch (error) {
      console.warn('[session] startup empty-session cleanup failed:', error)
    }
    initModelConfig()
    setBusinessIpcAvailable(true)
    registerIpcHandlers()
    if (!themeSmoke) startSessionRechecks()
  }
  const mainWindow = createWindow(authStatus.state !== 'authenticated')

  if (!app.isPackaged && ['1', 'locked', 'unlocked'].includes(process.env.AI_AGENT_AUTH_SMOKE ?? '')) {
    try {
      await new Promise<void>((resolve) => mainWindow.webContents.once('did-finish-load', () => resolve()))
      const result = await mainWindow.webContents.executeJavaScript(`(async () => {
        const status = await window.agent.auth.status()
        let businessAllowed = false
        try { businessAllowed = Boolean((await window.agent.session.list()).ok) } catch {}
        return { locked: Boolean(document.querySelector('.login-lock')),
          state: status.data?.state, businessAllowed }
      })()`)
      const expectedUnlocked = process.env.AI_AGENT_AUTH_SMOKE === 'unlocked'
      if (expectedUnlocked) {
        if (result.locked || result.state !== 'authenticated' || !result.businessAllowed) throw new Error(JSON.stringify(result))
      } else if (!result.locked || result.state === 'authenticated' || result.businessAllowed) {
        throw new Error(JSON.stringify(result))
      }
      if (process.env.AI_AGENT_AUTH_SCREENSHOT) {
        await new Promise((resolve) => setTimeout(resolve, 700))
        writeFileSync(process.env.AI_AGENT_AUTH_SCREENSHOT, (await mainWindow.webContents.capturePage()).toPNG())
      }
      console.log(expectedUnlocked
        ? '[auth-smoke] PASS: verified session unlocked renderer and business IPC'
        : '[auth-smoke] PASS: locked renderer and rejected business IPC')
      app.exit(0)
    } catch (error) {
      console.error('[auth-smoke] FAIL:', error)
      app.exit(1)
    }
    return
  }

  // 真实窗口主题验收：只在显式开启时运行，用于替代纯 jsdom 的假验证。
  if (themeSmoke) {
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
    if (BrowserWindow.getAllWindows().length === 0) createWindow(authStatus.state !== 'authenticated')
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
  closeAllTerminals()
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
    Promise.all([
      flushTaskPersistence(),
      closeOfficialChromeBrowserRuntime(),
      emptySessionCleanup
    ]).then(() => undefined),
    timeout
  ])
    .catch((error) => console.warn('[agent] final task journal flush failed:', error))
    .finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      shutdownComplete = true
      app.quit()
    })
})
