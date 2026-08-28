import { useSessionStore } from '../../stores/sessionStore'
import { useChatStore } from '../../stores/chatStore'
import { MessageList } from '../chat/MessageList'
import { ChatInput } from '../chat/ChatInput'
import { Icon } from '../ui/icons'

export default function ChatPanel(): JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const sessions = useSessionStore((s) => s.sessions)
  const create = useSessionStore((s) => s.create)
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] : undefined))
  const active = sessions.find((s) => s.id === activeId)

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg-app">
      {/* 顶部 tab */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <button
          onClick={() => void create()}
          className="flex items-center gap-1.5 rounded-t-md px-3 text-[12px] text-txt-muted hover:bg-bg-panel hover:text-txt-secondary"
        >
          <Icon.Plus size={14} />
          新对话
        </button>
        {active && (
          <div className="flex items-center gap-1.5 border-b-2 border-accent px-3 text-[12px] text-txt-primary">
            <span className="selectable max-w-[160px] truncate">{active.title || '新对话'}</span>
            <button className="text-txt-muted hover:text-txt-primary" onClick={() => void create()}>
              <Icon.X size={13} />
            </button>
          </div>
        )}
      </div>

      {/* 标题 + 徽标 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="selectable text-[13px] font-medium text-txt-primary">
          {active?.title || '新对话'}
        </span>
        <span className="chip border border-accent bg-accent-dim/20 text-accent">智能模式</span>
      </div>

      <MessageList messages={messages ?? []} />
      <ChatInput sessionId={activeId ?? ''} />
    </main>
  )
}
