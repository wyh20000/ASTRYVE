import { useEffect, useState } from 'react'
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
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  useEffect(() => { setProjectPickerOpen(false) }, [activeId])

  return (
    <main className="flex min-h-0 min-w-[340px] flex-1 flex-col bg-bg-app">
      {/* 工作/对话是会话类型，跨类型进入时新建会话，不转换历史。 */}
      <div className="relative shrink-0" onKeyDown={(event) => { if (event.key === 'Escape') setProjectPickerOpen(false) }}>
        <div role="tablist" aria-label="会话类型" className="flex h-10 items-center gap-1 border-b border-border px-2">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'work'}
            aria-expanded={mode === 'chat' ? projectPickerOpen : undefined}
            aria-controls="work-project-picker"
            onClick={() => {
              if (mode === 'work') return
              setProjectPickerOpen((open) => !open)
            }}
            className={`rounded-t-md px-4 text-[14px] ${mode === 'work' ? 'border-b-2 border-accent text-txt-primary' : 'text-txt-muted hover:bg-bg-panel'}`}
          >
            工作
          </button>
          <button type="button" role="tab" aria-selected={mode === 'chat'}
            onClick={() => { setProjectPickerOpen(false); if (mode !== 'chat') void create() }}
            className={`rounded-t-md px-4 text-[14px] ${mode === 'chat' ? 'border-b-2 border-accent text-txt-primary' : 'text-txt-muted hover:bg-bg-panel'}`}>
            对话
          </button>
        </div>
        {mode === 'chat' && projectPickerOpen && <div id="work-project-picker" role="dialog" aria-label="选择工作项目"
          className="absolute left-2 top-10 z-20 w-[min(360px,calc(100vw-24px))] rounded-lg border border-border bg-bg-panel p-2 shadow-xl">
          <div className="px-2 py-1 text-[14px] text-txt-secondary">选择项目，开始新的工作会话</div>
          {recent.map((workspace) => <button key={workspace.id} type="button"
            className="flex w-full flex-col rounded-md px-2 py-2 text-left hover:bg-bg-raised"
            onClick={() => { setProjectPickerOpen(false); void createWork(workspace.id) }}>
            <span className="text-[14px] text-txt-primary">{workspace.name}</span>
            <span className="max-w-full truncate text-[14px] text-txt-muted" title={workspace.displayPath}>{workspace.displayPath}</span>
          </button>)}
          <button type="button" className="w-full rounded-md px-2 py-2 text-left text-[14px] text-accent hover:bg-bg-raised"
            onClick={() => { setProjectPickerOpen(false); void selectAndCreateWork() }}>选择其他项目…</button>
          <button type="button" className="w-full rounded-md px-2 py-2 text-left text-[14px] text-txt-muted hover:bg-bg-raised"
            onClick={() => setProjectPickerOpen(false)}>取消</button>
        </div>}
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
