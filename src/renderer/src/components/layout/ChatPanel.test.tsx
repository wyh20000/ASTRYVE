/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'

const state = vi.hoisted(() => ({
  activeId: 'chat' as string | null,
  sessions: [] as Session[],
  create: vi.fn(),
  createWork: vi.fn(),
  close: vi.fn(),
  selectAndCreateWork: vi.fn(),
  selectAndActivate: vi.fn(),
  recent: [{ id: 'workspace-a', name: 'project-a', displayPath: 'D:\\project-a', createdAt: 1, lastOpenedAt: 1 }]
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (selector: (value: unknown) => unknown) => selector(state)
}))
vi.mock('../../stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (value: unknown) => unknown) => selector({
    recent: state.recent, selectAndCreateWork: state.selectAndCreateWork,
    selectAndActivate: state.selectAndActivate
  })
}))
vi.mock('../../stores/chatStore', () => ({
  useChatStore: (selector: (value: unknown) => unknown) => selector({
    messages: {}, hasOlder: {}, loadingOlder: {}, loadErrors: {}, load: vi.fn(), loadOlder: vi.fn()
  })
}))
vi.mock('../../stores/uiStore', () => ({
  useUiStore: (selector: (value: unknown) => unknown) => selector({ toggleWorkspace: vi.fn() })
}))
vi.mock('../chat/MessageList', () => ({ MessageList: () => <div data-testid="messages" /> }))
vi.mock('../chat/ChatInput', () => ({ ChatInput: () => <div data-testid="input" /> }))

import ChatPanel from './ChatPanel'

const chat: Session = { id: 'chat', title: '普通讨论', kind: 'chat', projectPath: null,
  pinned: false, createdAt: 1, updatedAt: 1 }
const work: Session = { id: 'work', title: '项目讨论', kind: 'work', workspaceId: 'workspace-a',
  projectPath: 'D:\\project-a', pinned: false, createdAt: 2, updatedAt: 2 }

describe('work and chat tabs', () => {
  beforeEach(() => {
    state.sessions = [work, chat]
    state.activeId = 'chat'
    state.recent = [{ id: 'workspace-a', name: 'project-a', displayPath: 'D:\\project-a', createdAt: 1, lastOpenedAt: 1 }]
    state.create.mockClear()
    state.createWork.mockClear()
    state.close.mockClear()
    state.selectAndCreateWork.mockClear()
    state.selectAndActivate.mockClear()
  })

  it('requires a project choice before opening a work conversation', async () => {
    render(<ChatPanel />)
    await userEvent.click(screen.getByRole('tab', { name: '工作' }))
    expect(state.createWork).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '选择工作项目' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /project-a.*D:\\project-a/ }))
    expect(state.createWork).toHaveBeenCalledWith('workspace-a')
    expect(state.create).not.toHaveBeenCalled()
  })

  it('can choose a different project without silently falling back to the last one', async () => {
    state.recent = [
      { id: 'workspace-a', name: 'project-a', displayPath: 'D:\\project-a', createdAt: 1, lastOpenedAt: 1 },
      { id: 'workspace-b', name: 'project-b', displayPath: 'D:\\project-b', createdAt: 1, lastOpenedAt: 2 }
    ]
    render(<ChatPanel />)
    await userEvent.click(screen.getByRole('tab', { name: '工作' }))
    await userEvent.click(screen.getByRole('button', { name: /project-b.*D:\\project-b/ }))
    expect(state.createWork).toHaveBeenCalledWith('workspace-b')
    expect(state.createWork).toHaveBeenCalledTimes(1)
  })

  it('keeps the current chat when the project picker is cancelled', async () => {
    render(<ChatPanel />)
    await userEvent.click(screen.getByRole('tab', { name: '工作' }))
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(state.createWork).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: '选择工作项目' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '对话' })).toHaveAttribute('aria-selected', 'true')
  })

  it('closes the project picker with Escape from the work tab', async () => {
    render(<ChatPanel />)
    const tab = screen.getByRole('tab', { name: '工作' })
    await userEvent.click(tab)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '选择工作项目' })).not.toBeInTheDocument()
    expect(state.createWork).not.toHaveBeenCalled()
  })

  it('can select a new project from the picker', async () => {
    render(<ChatPanel />)
    await userEvent.click(screen.getByRole('tab', { name: '工作' }))
    await userEvent.click(screen.getByRole('button', { name: '选择其他项目…' }))
    expect(state.selectAndCreateWork).toHaveBeenCalledOnce()
  })

  it('does not reopen a stale picker when returning to the old chat', async () => {
    const view = render(<ChatPanel />)
    await userEvent.click(screen.getByRole('tab', { name: '工作' }))
    state.activeId = 'work'
    view.rerender(<ChatPanel />)
    state.activeId = 'chat'
    view.rerender(<ChatPanel />)
    expect(screen.queryByRole('dialog', { name: '选择工作项目' })).not.toBeInTheDocument()
  })

  it('opens a separate ordinary conversation without converting project history', async () => {
    state.activeId = 'work'
    render(<ChatPanel />)
    await userEvent.click(screen.getByRole('tab', { name: '对话' }))
    expect(state.create).toHaveBeenCalledOnce()
    expect(state.createWork).not.toHaveBeenCalled()
    expect(state.sessions).toEqual([work, chat])
  })

  it('closes only the current view and leaves session history untouched', async () => {
    render(<ChatPanel />)
    await userEvent.click(screen.getByRole('button', { name: '关闭当前会话视图' }))
    expect(state.close).toHaveBeenCalledOnce()
    expect(state.sessions).toEqual([work, chat])
  })

  it('does not mount a chat input when no view is open', () => {
    state.activeId = null
    render(<ChatPanel />)
    expect(screen.getByText('未打开会话')).toBeInTheDocument()
    expect(screen.queryByTestId('input')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '工作' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: '对话' })).toHaveAttribute('aria-selected', 'false')
  })

  it('keeps revoked work history readable but pauses sending until the original project is reauthorized', async () => {
    state.activeId = 'work'
    state.recent = []
    render(<ChatPanel />)
    expect(screen.getByTestId('messages')).toBeInTheDocument()
    expect(screen.queryByTestId('input')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('项目授权已失效')
    await userEvent.click(screen.getByRole('button', { name: '重新授权原项目' }))
    expect(state.selectAndActivate).toHaveBeenCalledWith('work')
  })
})
