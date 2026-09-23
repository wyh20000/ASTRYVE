import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'
import { useSessionStore } from './sessionStore'
import { useChatStore } from './chatStore'
import { useUiStore } from './uiStore'

const session = (id: string, title: string, updatedAt: number): Session => ({
  id, title, kind: 'chat', projectPath: null, pinned: false, createdAt: updatedAt, updatedAt
})

describe('session store empty conversation reuse', () => {
  afterEach(() => {
    useSessionStore.setState({ sessions: [], activeId: null, loading: false, error: null })
    useChatStore.getState().clear()
    useUiStore.getState().clearDrafts()
    vi.unstubAllGlobals()
  })

  it('does not create another conversation while an empty new conversation exists', async () => {
    const create = vi.fn()
    useSessionStore.setState({ sessions: [session('empty', '', 1)], activeId: 'empty' })
    vi.stubGlobal('window', { agent: { session: { create } } })
    await expect(useSessionStore.getState().create()).resolves.toMatchObject({ id: 'empty' })
    expect(create).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessions).toHaveLength(1)
  })

  it('selects an existing empty conversation during initialization even when it is not first', async () => {
    const create = vi.fn()
    vi.stubGlobal('window', { agent: { session: {
      list: vi.fn(async () => ({ ok: true, data: [session('recent', '有内容', 2), session('empty', '', 1)] })),
      create
    } } })
    await useSessionStore.getState().init()
    expect(useSessionStore.getState().activeId).toBe('empty')
    expect(create).not.toHaveBeenCalled()
  })

  it('coalesces concurrent initialization attempts', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const list = vi.fn(async () => { await waiting; return { ok: true as const, data: [] } })
    const create = vi.fn(async () => ({ ok: true as const, data: session('empty', '', 1) }))
    vi.stubGlobal('window', { agent: { session: { list, create } } })
    const first = useSessionStore.getState().init()
    const second = useSessionStore.getState().init()
    release()
    await Promise.all([first, second])
    expect(list).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(useSessionStore.getState().sessions).toHaveLength(1)
  })

  it('deleting a session also removes its draft and cached chat state', async () => {
    useSessionStore.setState({ sessions: [session('gone', '旧会话', 1)], activeId: 'gone' })
    useChatStore.setState({ messages: { gone: [{ id: 'm', sessionId: 'gone', role: 'user',
      content: '私有内容', status: 'done', timestamp: 1 }] }, sending: { gone: true } })
    useUiStore.getState().updateDraft('gone', (draft) => ({ ...draft, value: '未发送' }))
    vi.stubGlobal('window', { agent: { session: { remove: vi.fn(async () => ({ ok: true, data: { id: 'gone' } })) } } })
    await useSessionStore.getState().remove('gone')
    expect(useChatStore.getState().messages.gone).toBeUndefined()
    expect(useChatStore.getState().sending.gone).toBeUndefined()
    expect(useUiStore.getState().drafts.gone).toBeUndefined()
    expect(useSessionStore.getState().sessions).toEqual([])
  })

  it('never reuses an empty chat as a project work session', async () => {
    useSessionStore.setState({ sessions: [session('empty-chat', '', 1)], activeId: 'empty-chat' })
    const created = { ...session('work-a', '', 2), kind: 'work' as const,
      projectPath: 'D:\\project-a', workspaceId: 'workspace-a' }
    const create = vi.fn(async () => ({ ok: true as const, data: created }))
    vi.stubGlobal('window', { agent: { session: { create } } })
    await useSessionStore.getState().createWork('workspace-a')
    expect(create).toHaveBeenCalledWith({ title: undefined, kind: 'work', workspaceId: 'workspace-a' })
    expect(useSessionStore.getState().activeId).toBe('work-a')
    await useSessionStore.getState().createWork('workspace-a')
    expect(create).toHaveBeenCalledTimes(1)
  })
})
