import { useEffect } from 'react'
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

export default function App(): JSX.Element {
  const init = useSessionStore((s) => s.init)
  const activeId = useSessionStore((s) => s.activeId)
  const load = useChatStore((s) => s.load)
  const upsertMessage = useChatStore((s) => s.upsertMessage)
  const create = useSessionStore((s) => s.create)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const loadModel = useModelStore((s) => s.load)

  useEffect(() => {
    void init()
    void loadModel()
  }, [init, loadModel])

  useEffect(() => {
    const unsub = window.agent.onMessageStreamed((m) => upsertMessage(m))
    return unsub
  }, [upsertMessage])

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
        </div>
      )}
      <StatusBar />
    </div>
  )
}