/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'

const state = vi.hoisted(() => ({
  sessions: [] as Session[],
  activeId: 'work',
  create: vi.fn(),
  createWork: vi.fn(),
  selectAndCreateWork: vi.fn(),
  recent: [{ id: 'workspace-b', name: 'Other', displayPath: 'D:\\other', createdAt: 1, lastOpenedAt: 1 }]
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (selector: (value: unknown) => unknown) => selector({
    sessions: state.sessions, activeId: state.activeId, create: state.create,
    createWork: state.createWork, error: null
  })
}))
vi.mock('../../stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (value: unknown) => unknown) => selector({
    recent: state.recent, error: null, selectAndCreateWork: state.selectAndCreateWork
  })
}))
vi.mock('../../stores/uiStore', () => ({
  useUiStore: (selector: (value: unknown) => unknown) => selector({
    sidebarOpen: true, sidebarWidth: 250, searchQuery: '', setSearchQuery: vi.fn(), toggleSidebar: vi.fn()
  })
}))
vi.mock('../sidebar/SessionList', () => ({ default: () => <div /> }))
vi.mock('../sidebar/SidebarFooter', () => ({ default: () => <div /> }))

import Sidebar from './Sidebar'

describe('work session creation in the sidebar', () => {
  beforeEach(() => {
    state.sessions = [{ id: 'work', title: 'Existing', kind: 'work', workspaceId: 'workspace-a',
      projectPath: 'D:\\project-a', pinned: false, createdAt: 1, updatedAt: 1 }]
    state.recent = [{ id: 'workspace-b', name: 'Other', displayPath: 'D:\\other', createdAt: 1, lastOpenedAt: 1 }]
    state.create.mockClear()
    state.createWork.mockClear()
    state.selectAndCreateWork.mockClear()
  })

  it('does not silently create work under a different recent project', async () => {
    render(<Sidebar />)
    await userEvent.click(screen.getByRole('button', { name: '新工作会话' }))
    expect(state.createWork).not.toHaveBeenCalled()
    expect(state.selectAndCreateWork).toHaveBeenCalledOnce()
  })

  it('reuses the currently authorized project when it is still present', async () => {
    state.recent = [{ id: 'workspace-a', name: 'Project', displayPath: 'D:\\project-a', createdAt: 1, lastOpenedAt: 1 }]
    render(<Sidebar />)
    await userEvent.click(screen.getByRole('button', { name: '新工作会话' }))
    expect(state.createWork).toHaveBeenCalledWith('workspace-a')
    expect(state.selectAndCreateWork).not.toHaveBeenCalled()
  })
})
