import { useSessionStore } from '../../stores/sessionStore'
import { useChatStore } from '../../stores/chatStore'
import { MessageList } from '../chat/MessageList'
import { ChatInput } from '../chat/ChatInput'
import { Icon } from '../ui/icons'
import { IconButton } from '../ui'
import { useUiStore } from '../../stores/uiStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

export default function ChatPanel(): JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const sessions = useSessionStore((s) => s.sessions)
  const create = useSessionStore((s) => s.create)
  const createWork = useSessionStore((s) => s.createWork)
  const recent = useWorkspaceStore((s) => s.recent)
  const selectAndCreateWork = useWorkspaceStore((s) => s.selectAndCreateWork)
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] : undefined))
  const hasOlder = useChatStore((s) => activeId ? s.hasOlder[activeId] ?? false : false)
  const loadingOlder = useChatStore((s) => activeId ? s.loadingOlder[activeId] ?? false : false)
  const loadError = useChatStore((s) => activeId ? s.loadErrors[activeId] : undefined)
  const load = useChatStore((s) => s.load)
  const loadOlder = useChatStore((s) => s.loadOlder)
  const active = sessions.find((s) => s.id === activeId)
  const mode = active?.projectPath ? 'work' : 'chat'
  const toggleWorkspace = useUiStore((s) => s.toggleWorkspace)

  return (
    <main className="flex min-h-0 min-w-[340px] flex-1 flex-col bg-bg-app">
      {/* 工作/对话是会话类型，跨类型进入时新建会话，不转换历史。 */}
      <div role="tablist" aria-label="会话类型" className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'work'}
          onClick={() => {
            if (mode === 'work') return
            const lastWork = sessions.find((session) => session.projectPath)
            const target = recent.find((workspace) => workspace.id === lastWork?.workspaceId ||
              workspace.displayPath === lastWork?.projectPath)?.id ?? recent[0]?.id
            if (target) void createWork(target)
            else void selectAndCreateWork()
          }}
          className={`rounded-t-md px-4 text-[14px] ${mode === 'work' ? 'border-b-2 border-accent text-txt-primary' : 'text-txt-muted hover:bg-bg-panel'}`}
        >
          工作
        </button>
        <button type="button" role="tab" aria-selected={mode === 'chat'}
          onClick={() => { if (mode !== 'chat') void create() }}
          className={`rounded-t-md px-4 text-[14px] ${mode === 'chat' ? 'border-b-2 border-accent text-txt-primary' : 'text-txt-muted hover:bg-bg-panel'}`}>
          对话
        </button>
      </div>

      {/* 标题 + 徽标 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="selectable min-w-0 flex-1 truncate text-[14px] font-medium text-txt-primary">
          {active?.title || '新对话'}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {active?.projectPath && <span className="chip max-w-[240px] truncate" title={active.projectPath}>{active.projectPath.split(/[\\/]/).filter(Boolean).at(-1)}</span>}
          {active?.projectPath && <IconButton icon={<Icon.Layout size={15} />} label="切换任务工作区" onClick={toggleWorkspace} />}
        </div>
      </div>

      {loadError && activeId && <div role="alert" className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border border-border bg-bg-panel px-3 py-2 text-[13px] text-txt-secondary">
        <span>历史记录读取失败：{loadError}</span>
        <button type="button" className="shrink-0 text-accent hover:underline" onClick={() => void load(activeId)}>重试</button>
      </div>}
      <MessageList key={activeId ?? 'empty'} messages={messages ?? []} hasOlder={hasOlder}
        loadingOlder={loadingOlder} loadError={Boolean(loadError)}
        onLoadOlder={() => activeId ? loadOlder(activeId) : Promise.resolve()} />
      <ChatInput sessionId={activeId ?? ''} />
    </main>
  )
}
