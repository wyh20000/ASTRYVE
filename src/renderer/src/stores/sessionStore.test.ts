import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'
import { useSessionStore } from './sessionStore'

const session = (id: string, title: string, updatedAt: number): Session => ({
  id, title, projectPath: null, pinned: false, createdAt: updatedAt, updatedAt
})

describe('session store empty conversation reuse', () => {
  afterEach(() => {
    useSessionStore.setState({ sessions: [], activeId: null, loading: false, error: null })
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
})
