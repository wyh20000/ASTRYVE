import { useSessionStore } from '../../stores/sessionStore'
import { useUiStore } from '../../stores/uiStore'
import SessionList from '../sidebar/SessionList'
import SidebarFooter from '../sidebar/SidebarFooter'
import { Icon } from '../ui/icons'

export default function Sidebar(): JSX.Element {
  const open = useUiStore((s) => s.sidebarOpen)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const create = useSessionStore((s) => s.create)
  const searchQuery = useUiStore((s) => s.searchQuery)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)
  const toggle = useUiStore((s) => s.toggleSidebar)

  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center border-r border-border bg-bg-panel py-2">
        <button className="btn-icon" title="展开侧栏" onClick={toggle}>
          <Icon.Plus size={16} />
        </button>
      </div>
    )
  }

  return (
    <aside className="flex shrink-0 flex-col bg-bg-panel" style={{ width: sidebarWidth }}>
      {/* 顶栏 */}
      <div className="flex h-12 items-center gap-2 px-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent">
          <Icon.Brain size={16} className="text-white" />
        </div>
        <span className="text-[15px] font-semibold text-txt-primary">AI Agent</span>
        <button className="ml-auto btn-icon" onClick={toggle} title="收起侧栏">
          <Icon.Layout size={16} />
        </button>
      </div>

      {/* 新对话 + 搜索 */}
      <div className="space-y-2 px-3 py-2">
        <button
          onClick={() => void create()}
          className="btn w-full justify-between border border-border bg-bg-raised px-3 py-1.5 text-txt-primary hover:border-accent"
        >
          <span className="flex items-center gap-1.5">
            <Icon.Plus size={14} />
            新对话
          </span>
          <kbd className="rounded border border-border bg-bg-active px-1 text-[10px] text-txt-muted">
            ⌘K
          </kbd>
        </button>
        <div className="relative">
          <Icon.Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-muted" />
          <input
            id="session-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话..."
            className="input pl-8"
          />
        </div>
      </div>

      {/* 分组标题 */}
      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <span className="text-[12px] font-medium text-txt-secondary">对话</span>
        <button className="text-txt-muted hover:text-txt-primary" onClick={() => void create()}>
          <Icon.Plus size={14} />
        </button>
      </div>

      <SessionList />

      <SidebarFooter />
    </aside>
  )
}