/**
 * @vitest-environment jsdom
 *
 * 侧栏会话列表的行为与可访问性约束。
 *
 * 按文档第 10 节的迁移规则：先补行为测试，再替换展示层。
 * 这里同时锁住三件不能回归的业务能力：
 *  - 点击会话切换当前会话（select）；
 *  - 删除需要二次确认，确认后才调用 remove；
 *  - 搜索过滤与「今天/昨天/更早」分组保持不变。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'

const sessionState = vi.hoisted(() => ({
  sessions: [] as Session[],
  activeId: null as string | null,
  select: vi.fn(),
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
})

describe('会话列表 - 分组与时间', () => {
  it('按今天 / 昨天 / 更早分组', () => {
    sessionState.sessions = [
      session('a', '今天的会话', NOW),
      session('b', '昨天的会话', NOW - 86400000),
      session('c', '更早的会话', NOW - 86400000 * 5)
    ]
    render(<SessionList />)

    expect(screen.getByText('今天')).toBeInTheDocument()
    expect(screen.getByText('昨天')).toBeInTheDocument()
    expect(screen.getByText('更早')).toBeInTheDocument()
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
