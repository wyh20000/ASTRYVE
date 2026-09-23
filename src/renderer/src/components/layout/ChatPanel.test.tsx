/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'

const state = vi.hoisted(() => ({
  activeId: 'chat',
  sessions: [] as Session[],
  create: vi.fn(),
  createWork: vi.fn(),
  recent: [{ id: 'workspace-a', name: 'project-a', displayPath: 'D:\\project-a', createdAt: 1, lastOpenedAt: 1 }]
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (selector: (value: unknown) => unknown) => selector(state)
}))
vi.mock('../../stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (value: unknown) => unknown) => selector({
    recent: state.recent, selectAndCreateWork: vi.fn()
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
    state.create.mockClear()
    state.createWork.mockClear()
  })

  it('opens a new work conversation in the last authorized project', async () => {
    render(<ChatPanel />)
    await userEvent.click(screen.getByRole('tab', { name: '工作' }))
    expect(state.createWork).toHaveBeenCalledWith('workspace-a')
    expect(state.create).not.toHaveBeenCalled()
  })

  it('opens a separate ordinary conversation without converting project history', async () => {
    state.activeId = 'work'
    render(<ChatPanel />)
    await userEvent.click(screen.getByRole('tab', { name: '对话' }))
    expect(state.create).toHaveBeenCalledOnce()
    expect(state.createWork).not.toHaveBeenCalled()
    expect(state.sessions).toEqual([work, chat])
  })
})
