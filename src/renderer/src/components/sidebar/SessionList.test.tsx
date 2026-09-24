/**
 * @vitest-environment jsdom
 *
 * 侧栏会话列表的行为与可访问性约束。
 *
 * 按文档第 10 节的迁移规则：先补行为测试，再替换展示层。
 * 这里同时锁住三件不能回归的业务能力：
 *  - 点击会话切换当前会话（select）；
 *  - 删除需要二次确认，确认后才调用 remove；
 *  - 搜索过滤与「项目在前、普通对话在末尾」分组保持不变。
 *
 * 阶段 C（文档 7.4）之后列表容器改为 Ant Design X 的 `Conversations`，
 * 因此文件末尾额外锁定「迁移确实是 Conversations 驱动的」这组契约
 * （组件类名、activeKey 映射、分组顺序），避免迁移退化成只改了外观。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalUiRequest, Session } from '@shared/types'
import { useChatStore } from '../../stores/chatStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

const sessionState = vi.hoisted(() => ({
  sessions: [] as Session[],
  activeId: null as string | null,
  select: vi.fn(),
  createWork: vi.fn(),
  remove: vi.fn(async () => undefined)
}))

const uiState = vi.hoisted(() => ({
  searchQuery: '',
  sidebarOpen: true,
  sidebarWidth: 260,
  openSettings: vi.fn(),
  toggleSidebar: vi.fn(),
  setSearchQuery: vi.fn()
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (selector: (s: Record<string, unknown>) => unknown) => selector(sessionState)
}))
vi.mock('../../stores/uiStore', () => ({
  useUiStore: (selector: (s: Record<string, unknown>) => unknown) => selector(uiState)
}))

import SessionList from './SessionList'

const NOW = Date.now()
const originalRevoke = useWorkspaceStore.getState().revoke

function session(id: string, title: string, updatedAt: number): Session {
  return {
    id,
    title,
    createdAt: updatedAt,
    updatedAt
  } as Session
}

beforeEach(() => {
  sessionState.sessions = []
  sessionState.activeId = null
  sessionState.select.mockReset()
  sessionState.remove.mockReset()
  sessionState.remove.mockImplementation(async () => undefined)
  uiState.searchQuery = ''
  useChatStore.getState().clear()
  useWorkspaceStore.setState({ recent: [], revoke: originalRevoke })
})

describe('会话列表 - 分组与时间', () => {
  it('按项目分组，普通对话放在最下方', () => {
    sessionState.sessions = [
      { ...session('a', '项目 A 会话', NOW), projectPath: 'D:\\project-a', kind: 'work' },
      { ...session('b', '项目 B 会话', NOW - 86400000), projectPath: 'D:\\project-b', kind: 'work' },
      session('c', '普通会话', NOW - 86400000 * 5)
    ]
    render(<SessionList />)

    expect(screen.getByText('project-a')).toBeInTheDocument()
    expect(screen.getByText('project-b')).toBeInTheDocument()
    expect(screen.getByText('普通对话')).toBeInTheDocument()
  })

  it('项目组可用键盘折叠，普通对话始终保持可见', async () => {
    sessionState.sessions = [
      { ...session('work', '项目历史', NOW), projectPath: 'D:\\project-a', kind: 'work' },
      session('chat', '普通历史', NOW - 1)
    ]
    render(<SessionList />)
    const toggle = screen.getByRole('button', { name: '折叠或展开 D:\\project-a' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('普通历史')).toBeInTheDocument()
  })

  it('同一项目的路径分隔符差异不会拆成两个项目组', () => {
    sessionState.sessions = [
      { ...session('a', '项目记录 A', NOW), projectPath: 'D:\\project-a', workspaceId: 'workspace-a', kind: 'work' },
      { ...session('b', '项目记录 B', NOW - 1), projectPath: 'D:/project-a/', workspaceId: 'workspace-a', kind: 'work' }
    ]
    render(<SessionList />)
    expect(screen.getAllByRole('button', { name: /折叠或展开.*project-a/ })).toHaveLength(1)
    expect(screen.getByText('项目记录 A')).toBeInTheDocument()
    expect(screen.getByText('项目记录 B')).toBeInTheDocument()
  })

  it('从搜索结果切到折叠项目后自动展开该项目', async () => {
    sessionState.sessions = [
      { ...session('work', '项目记录', NOW), projectPath: 'D:\\project-a', kind: 'work' },
      session('chat', '普通记录', NOW - 1)
    ]
    sessionState.activeId = 'chat'
    const view = render(<SessionList />)
    const toggle = screen.getByRole('button', { name: '折叠或展开 D:\\project-a' })
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    uiState.searchQuery = '项目'
    view.rerender(<SessionList />)
    await userEvent.click(screen.getByText('项目记录'))
    sessionState.activeId = 'work'
    uiState.searchQuery = ''
    view.rerender(<SessionList />)
    await waitFor(() => expect(screen.getByRole('button', { name: '折叠或展开 D:\\project-a' }))
      .toHaveAttribute('aria-expanded', 'true'))
  })

  it('项目授权移除需二次确认，且不删除历史会话', async () => {
    const revoke = vi.fn(async () => true)
    useWorkspaceStore.setState({ recent: [{ id: 'workspace-a', name: 'Project A',
      displayPath: 'D:\\project-a', createdAt: 1, lastOpenedAt: 1 }], revoke })
    sessionState.sessions = [{ ...session('work', '保留的记录', NOW),
      projectPath: 'D:\\project-a', workspaceId: 'workspace-a', kind: 'work' }]
    render(<SessionList />)
    await userEvent.click(screen.getByRole('button', { name: '移除 Project A 的项目授权' }))
    expect(revoke).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '确认移除 Project A 的项目授权' }))
    expect(revoke).toHaveBeenCalledWith('workspace-a')
    expect(sessionState.remove).not.toHaveBeenCalled()
    expect(screen.getByText('保留的记录')).toBeInTheDocument()
  })

  it('空列表显示空状态', () => {
    render(<SessionList />)
    expect(screen.getByText('暂无会话')).toBeInTheDocument()
  })

  it('搜索词过滤会话标题', () => {
    sessionState.sessions = [session('a', '前端重构', NOW), session('b', '数据库迁移', NOW)]
    uiState.searchQuery = '数据库'
    render(<SessionList />)

    expect(screen.getByText('数据库迁移')).toBeInTheDocument()
    expect(screen.queryByText('前端重构')).not.toBeInTheDocument()
  })

  it('无标题会话显示占位标题', () => {
    sessionState.sessions = [session('a', '', NOW)]
    render(<SessionList />)
    expect(screen.getByText('新对话')).toBeInTheDocument()
  })

  it('后台会话有待审批请求时在侧栏标记来源', () => {
    sessionState.sessions = [session('a', '会话 A', NOW), session('b', '会话 B', NOW)]
    sessionState.activeId = 'a'
    useChatStore.setState({ approvalRequests: { b: { id: 'approval', sessionId: 'b',
      expiresAt: Date.now() + 60_000 } as ApprovalUiRequest } })
    render(<SessionList />)
    expect(screen.getByRole('button', { name: /会话 B.*待审批/ })).toBeInTheDocument()
    expect(screen.getAllByText('待审批')).toHaveLength(1)
  })
})

describe('会话列表 - 选择与键盘可达', () => {
  it('点击会话行调用 select', async () => {
    sessionState.sessions = [session('a', '会话 A', NOW)]
    render(<SessionList />)

    await userEvent.click(screen.getByText('会话 A'))
    expect(sessionState.select).toHaveBeenCalledWith('a')
  })

  it('会话行可被键盘聚焦并激活（不能只支持鼠标）', async () => {
    sessionState.sessions = [session('a', '会话 A', NOW)]
    render(<SessionList />)

    await userEvent.tab()
    const row = screen.getByRole('button', { name: /会话 A/ })
    expect(row).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    expect(sessionState.select).toHaveBeenCalledWith('a')
  })

  it('当前会话用 aria-current 暴露选中状态', () => {
    sessionState.sessions = [session('a', '会话 A', NOW), session('b', '会话 B', NOW)]
    sessionState.activeId = 'b'
    render(<SessionList />)

    expect(screen.getByRole('button', { name: /会话 B/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /会话 A/ })).not.toHaveAttribute('aria-current')
  })
})

describe('会话列表 - 删除需二次确认', () => {
  it('首次点击删除按钮不立即删除', async () => {
    sessionState.sessions = [session('a', '会话 A', NOW)]
    render(<SessionList />)

    await userEvent.click(screen.getByRole('button', { name: '删除会话' }))
    expect(sessionState.remove).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /确认删除/ })).toBeInTheDocument()
  })

  it('确认后才调用 remove', async () => {
    sessionState.sessions = [session('a', '会话 A', NOW)]
    render(<SessionList />)

    await userEvent.click(screen.getByRole('button', { name: '删除会话' }))
    await userEvent.click(screen.getByRole('button', { name: /确认删除/ }))

    await waitFor(() => expect(sessionState.remove).toHaveBeenCalledWith('a'))
  })

  it('确认操作不会连带切换当前会话', async () => {
    sessionState.sessions = [session('a', '会话 A', NOW)]
    render(<SessionList />)

    await userEvent.click(screen.getByRole('button', { name: '删除会话' }))
    await userEvent.click(screen.getByRole('button', { name: /确认删除/ }))

    expect(sessionState.select).not.toHaveBeenCalled()
  })
})

describe('会话列表 - 排版约束', () => {
  it('所有可见文字不小于 14px', () => {
    sessionState.sessions = [session('a', '会话 A', NOW)]
    const { container } = render(<SessionList />)
    const sizes = new Set<string>()
    for (const el of Array.from(container.querySelectorAll('*'))) {
      const cls = el.getAttribute('class')
      if (!cls) continue
      for (const m of cls.matchAll(/text-\[(\d+)px\]/g)) sizes.add(m[1])
    }
    expect([...sizes].sort()).toEqual(['14'])
  })
})

describe('会话列表 - 行内操作可访问性', () => {
  it('删除入口具备可访问名称，且与会话按钮平级（不嵌套 button）', () => {
    sessionState.sessions = [session('a', '会话 A', NOW)]
    render(<SessionList />)

    const rowButton = screen.getByRole('button', { name: /会话 A/ })
    const deleteButton = screen.getByRole('button', { name: '删除会话' })
    expect(deleteButton).toBeInTheDocument()
    // 嵌套 button 属于非法 HTML 且无法分别聚焦，两者必须是平级元素
    expect(rowButton.contains(deleteButton)).toBe(false)
  })
})

/**
 * 迁移契约（文档 7.4）。
 *
 * `Conversations` 的类名是本文件的**实现依据**，因此这里显式断言，
 * 保证「items / activeKey / onActiveChange / 分组」真的走组件契约，
 * 而不是替换成了一个只长得像的自制列表。
 */
describe('会话列表 - 由 Ant Design X Conversations 驱动', () => {
  it('使用 Conversations 作为列表容器', () => {
    sessionState.sessions = [session('a', '会话 A', NOW), session('b', '会话 B', NOW)]
    const { container } = render(<SessionList />)

    expect(container.querySelector('.ant-conversations')).not.toBeNull()
    expect(container.querySelectorAll('.ant-conversations-item')).toHaveLength(2)
  })

  it('activeKey 映射到当前会话（-item-active）', () => {
    sessionState.sessions = [session('a', '会话 A', NOW), session('b', '会话 B', NOW)]
    sessionState.activeId = 'b'
    const { container } = render(<SessionList />)

    const activeItems = container.querySelectorAll('.ant-conversations-item-active')
    expect(activeItems).toHaveLength(1)
    expect(activeItems[0].textContent).toContain('会话 B')
  })

  it('一次点击只调用一次 select（行按钮与列表不重复处理）', async () => {
    sessionState.sessions = [session('a', '会话 A', NOW)]
    render(<SessionList />)

    await userEvent.click(screen.getByText('会话 A'))
    expect(sessionState.select).toHaveBeenCalledTimes(1)
    expect(sessionState.select).toHaveBeenCalledWith('a')
  })

  it('点击行内空白区域（时间）同样切换会话', async () => {
    sessionState.sessions = [session('a', '会话 A', NOW)]
    render(<SessionList />)

    // 时间文本是行内非按钮区域：验证整行可点，而不只是标题按钮可点
    await userEvent.click(screen.getByText(/^\d{2}:\d{2}$/))
    expect(sessionState.select).toHaveBeenCalledWith('a')
  })

  it('项目按最近活动排序，普通对话始终位于最后', () => {
    sessionState.sessions = [
      session('c', '普通会话', NOW),
      { ...session('b', '项目 B 会话', NOW - 86400000), projectPath: 'D:\\project-b' },
      { ...session('a', '项目 A 会话', NOW - 86400000 * 5), projectPath: 'D:\\project-a' }
    ]
    const { container } = render(<SessionList />)

    const titles = Array.from(container.querySelectorAll('.ant-conversations-group-title')).map(
      (el) => el.textContent
    )
    expect(titles).toEqual(['project-b', 'project-a', '普通对话'])
  })
})
