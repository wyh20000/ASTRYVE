import { useSessionStore } from '../../stores/sessionStore'
import { useUiStore } from '../../stores/uiStore'
import SessionList from '../sidebar/SessionList'
import SidebarFooter from '../sidebar/SidebarFooter'
import { Button, IconButton, SearchInput } from '../ui'
import { Icon } from '../ui/icons'
import astryveIcon from '../../assets/astryve-icon.png'
import { useWorkspaceStore } from '../../stores/workspaceStore'

/**
 * 左侧会话管理（文档 8.2）。
 *
 * 结构节奏：Logo / 应用名 / 新对话 / 搜索 / 分组列表 / 底部设置。
 * 所有图标按钮使用全局 IconButton，具备可访问名称与统一点击区域；
 * 折叠态保留常用入口并提供 Tooltip。
 */
export default function Sidebar(): JSX.Element {
  const open = useUiStore((s) => s.sidebarOpen)
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const create = useSessionStore((s) => s.create)
  const createWork = useSessionStore((s) => s.createWork)
  const activeId = useSessionStore((s) => s.activeId)
  const sessionError = useSessionStore((s) => s.error)
  const sessions = useSessionStore((s) => s.sessions)
  const recent = useWorkspaceStore((s) => s.recent)
  const workspaceError = useWorkspaceStore((s) => s.error)
  const selectAndCreateWork = useWorkspaceStore((s) => s.selectAndCreateWork)
  const active = sessions.find((session) => session.id === activeId)
  const workMode = Boolean(active?.projectPath)
  const searchQuery = useUiStore((s) => s.searchQuery)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)
  const toggle = useUiStore((s) => s.toggleSidebar)

  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center border-r border-border-subtle bg-bg-panel py-2">
        <IconButton
          icon={<Icon.Layout size={16} />}
          label="展开侧栏"
          onClick={toggle}
        />
      </div>
    )
  }

  return (
    <aside
      className="flex min-w-[220px] shrink-0 flex-col border-r border-border-subtle bg-bg-panel"
      style={{ width: sidebarWidth, maxWidth: '32vw' }}
    >
      {/* 顶栏：Logo + 应用名 + 收起 */}
      <div className="flex h-12 items-center gap-2 px-3">
        <img className="h-7 w-7 rounded-lg" src={astryveIcon} alt="" />
        <span className="text-[16px] font-semibold tracking-[0.08em] text-txt-primary">ASTRYVE</span>
        <span className="ml-auto">
          <IconButton icon={<Icon.Layout size={16} />} label="收起侧栏" onClick={toggle} />
        </span>
      </div>

      {/* 当前类型的新会话 + 搜索 */}
      <div className="space-y-2 px-3 py-2">
        <Button block icon={<Icon.Plus size={14} />} onClick={() => {
          if (!workMode) { void create(); return }
          const target = recent.find((workspace) => workspace.id === active?.workspaceId ||
            workspace.displayPath === active?.projectPath)?.id
          if (target) void createWork(target)
          else void selectAndCreateWork()
        }}>
          {workMode ? '新工作会话' : '新对话'}
        </Button>
        <SearchInput
          id="session-search"
          aria-label="搜索会话"
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="搜索会话..."
        />
        {(sessionError || workspaceError) && <div role="alert" className="text-[13px] text-red-400">
          {sessionError || workspaceError}
        </div>}
      </div>

      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <span className="text-[14px] font-medium text-txt-secondary">项目与对话</span>
        <IconButton icon={<Icon.Plus size={14} />} label="选择项目并新建工作会话" size="sm"
          onClick={() => void selectAndCreateWork()} />
      </div>

      <SessionList />

      <SidebarFooter />
    </aside>
  )
}
