import { useEffect, useState } from 'react'
import { App as AntdApp } from 'antd'
import { XProvider } from '@ant-design/x'
import zhCN from '@ant-design/x/es/locale/zh_CN'
import Sidebar from './components/layout/Sidebar'
import ChatPanel from './components/layout/ChatPanel'
import StatusBar from './components/layout/StatusBar'
import TitleBar from './components/layout/TitleBar'
import ResizeHandle from './components/layout/ResizeHandle'
import SettingsPage from './components/layout/SettingsPage'
import { useSessionStore } from './stores/sessionStore'
import { useChatStore } from './stores/chatStore'
import { useUiStore } from './stores/uiStore'
import { useModelStore } from './stores/modelStore'
import { useResolvedTheme, useThemeStore } from './stores/themeStore'
import { toAntdTheme } from './theme/antdTheme'
import { useWorkspaceStore } from './stores/workspaceStore'
import WorkspacePanel from './components/layout/WorkspacePanel'
import ApprovalDialog from './components/chat/ApprovalDialog'
import { usePluginStore } from './stores/pluginStore'
import { LoginLockPage } from './components/auth/LoginLockPage'
import type { AuthStatus } from '@shared/types'

function AppShell(): JSX.Element {
  const { message: messageApi } = AntdApp.useApp()
  const init = useSessionStore((s) => s.init)
  const activeId = useSessionStore((s) => s.activeId)
  const activeProjectPath = useSessionStore((s) => s.sessions.find((session) => session.id === s.activeId)?.projectPath)
  const load = useChatStore((s) => s.load)
  const upsertMessage = useChatStore((s) => s.upsertMessage)
  const setInputRequest = useChatStore((s) => s.setInputRequest)
  const clearInputRequest = useChatStore((s) => s.clearInputRequest)
  const setApprovalRequest = useChatStore((s) => s.setApprovalRequest)
  const clearApprovalRequest = useChatStore((s) => s.clearApprovalRequest)
  const create = useSessionStore((s) => s.create)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const workspaceOpen = useUiStore((s) => s.workspaceOpen)
  const loadModel = useModelStore((s) => s.load)
  const loadWorkspaces = useWorkspaceStore((s) => s.load)

  useEffect(() => {
    void init()
    void loadModel()
    void loadWorkspaces()
    void useThemeStore.getState().hydrate()
  }, [init, loadModel, loadWorkspaces])

  useEffect(() => {
    const unsub = window.agent.onMessageStreamed((m) => upsertMessage(m))
    return unsub
  }, [upsertMessage])

  useEffect(() => window.agent.onUserInputRequested(setInputRequest), [setInputRequest])

  useEffect(() => window.agent.onUserInputResolved((request) => {
    clearInputRequest(request.sessionId, request.id)
  }), [clearInputRequest])

  useEffect(() => window.agent.onApprovalRequested(setApprovalRequest), [setApprovalRequest])

  useEffect(() => window.agent.onApprovalResolved((request) => {
    clearApprovalRequest(request.sessionId, request.id)
  }), [clearApprovalRequest])

  useEffect(() => window.agent.onPluginsChanged(() => {
    void usePluginStore.getState().load()
    void usePluginStore.getState().loadConnections()
    if (Object.values(useChatStore.getState().sending).some(Boolean)) {
      void messageApi.open({
        key: 'plugins-changed-active-task', type: 'warning', duration: 5,
        content: '插件已变化；当前任务继续使用原快照，下次发送时自动加载新工具。'
      })
    }
  }), [messageApi])

  useEffect(() => {
    const unsub = window.agent.onMessageNotice((notice) => {
      if (useChatStore.getState().removedSessions[notice.sessionId]) return
      void messageApi.open({
        key: notice.id,
        type: notice.level,
        content: notice.message,
        duration: 5
      })
    })
    return unsub
  }, [messageApi])

  useEffect(() => {
    if (activeId) void load(activeId)
  }, [activeId, load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.getElementById('session-search')?.focus()
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void create()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [create])

  return (
    <div className="flex h-screen w-screen flex-col bg-bg-app text-txt-primary">
      <TitleBar />
      {settingsOpen ? (
        <SettingsPage />
      ) : (
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          {sidebarOpen && <ResizeHandle />}
          <ChatPanel />
          {workspaceOpen && activeProjectPath && <WorkspacePanel />}
        </div>
      )}
      <StatusBar />
      <ApprovalDialog />
    </div>
  )
}

function AuthenticatedApp(): JSX.Element {
  // 主题令牌由 themeStore 统一解析；系统主题变化会更新 resolved 并触发重渲染。
  const theme = useResolvedTheme()

  /*
   * 根节点使用 XProvider 而不是 antd 的 ConfigProvider。
   *
   * 依据（docs/13-组件API参考.md）：@ant-design/x 的 XProvider 内部渲染
   * antd 的 ConfigProvider，并把它自己的组件级配置（bubble / conversations /
   * sender …）与 antd 配置合并到同一个 Provider 中，因此**只有一个主题源**，
   * 不会出现 antd 与 X 两套主题相互漂移的问题（设计文档 7.1 的要求）。
   *
   * 不要把 toAntdTheme 的结果断言成别的类型：它已标注为 ThemeConfig，
   * 任何字段写错都会在 typecheck 阶段报错。
   */
  return (
    <XProvider theme={toAntdTheme(theme)} locale={zhCN}>
      <AntdApp message={{ top: 48, maxCount: 3 }}>
        <AppShell />
      </AntdApp>
    </XProvider>
  )
}

export default function App(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  useEffect(() => {
    if (status && status.state !== 'authenticated') {
      useUiStore.getState().clearDrafts()
      useChatStore.getState().clear()
    }
  }, [status])
  useEffect(() => {
    let active = true
    void window.agent.auth.status().then((result) => {
      if (active) setStatus(result.ok ? result.data : { mode: 'remote', state: 'signedOut', message: result.error.message })
    }).catch(() => {
      if (active) setStatus({ mode: 'remote', state: 'offline', message: '无法确认登录状态，请检查网络后重试。' })
    })
    return () => { active = false }
  }, [])
  if (!status) return <div className="login-lock-loading">正在确认登录状态…</div>
  return status.state === 'authenticated' ? <AuthenticatedApp /> : <LoginLockPage initialStatus={status} />
}
