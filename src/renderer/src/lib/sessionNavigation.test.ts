import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'
import { createSessionInCurrentSpace, currentWorkProject } from './sessionNavigation'

const work: Session = { id: 'work', title: '项目', kind: 'work', workspaceId: 'workspace-a',
  projectPath: 'D:\\project-a', pinned: false, createdAt: 1, updatedAt: 1 }
const chat: Session = { ...work, id: 'chat', kind: 'chat', workspaceId: null, projectPath: null }
const recent = [
  { id: 'workspace-a', name: 'A', displayPath: 'D:/project-a/', createdAt: 1, lastOpenedAt: 1 },
  { id: 'workspace-b', name: 'B', displayPath: 'D:\\project-b', createdAt: 1, lastOpenedAt: 1 }
]

describe('new-session navigation', () => {
  it('keeps Ctrl+N in the current work project', async () => {
    const actions = { createChat: vi.fn(async () => undefined), createWork: vi.fn(async () => undefined),
      selectAndCreateWork: vi.fn(async () => undefined) }
    await createSessionInCurrentSpace(work, recent, actions)
    expect(actions.createWork).toHaveBeenCalledWith('workspace-a')
    expect(actions.createChat).not.toHaveBeenCalled()
  })

  it('never falls back to another project if the old grant is missing or its path changed', async () => {
    const actions = { createChat: vi.fn(async () => undefined), createWork: vi.fn(async () => undefined),
      selectAndCreateWork: vi.fn(async () => undefined) }
    expect(currentWorkProject(work, recent.slice(1))).toBeNull()
    expect(currentWorkProject(work, [{ ...recent[0], displayPath: 'D:\\different' }])).toBeNull()
    await createSessionInCurrentSpace(work, recent.slice(1), actions)
    expect(actions.selectAndCreateWork).toHaveBeenCalledOnce()
    expect(actions.createWork).not.toHaveBeenCalled()
  })

  it('creates an ordinary conversation when there is no active work session', async () => {
    const actions = { createChat: vi.fn(async () => undefined), createWork: vi.fn(async () => undefined),
      selectAndCreateWork: vi.fn(async () => undefined) }
    await createSessionInCurrentSpace(chat, recent, actions)
    await createSessionInCurrentSpace(undefined, recent, actions)
    expect(actions.createChat).toHaveBeenCalledTimes(2)
  })
})
