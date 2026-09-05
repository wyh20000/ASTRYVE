import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProjectSettings } from '@shared/types'
import { useAgentSettingsStore as store } from './agentSettingsStore'

const settings = (id: string): AgentProjectSettings => ({
  preferences: { workspaceId: id, permissionMode: 'ask-every-time', executionEnvironment: 'docker' },
  capabilities: { dockerAvailable: false, localAvailable: false }
})

describe('agent project settings requests', () => {
  const read = vi.fn()
  const save = vi.fn()
  beforeEach(() => {
    store.setState({ projects: {}, loading: {}, errors: {} })
    vi.stubGlobal('window', { agent: { settings: { getAgentProject: read, setAgentProject: save } } })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

  it('recovers from rejected IPC and permits retry', async () => {
    read.mockRejectedValueOnce(new Error('连接中断')).mockResolvedValueOnce({ ok: true, data: settings('a') })
    await store.getState().load('a')
    expect(store.getState().loading.a).toBe(false)
    expect(store.getState().errors.a).toBe('连接中断')
    await store.getState().load('a')
    expect(store.getState().projects.a).toEqual(settings('a'))
    expect(store.getState().errors.a).toBeUndefined()
  })

  it('preserves saved selections when a write fails', async () => {
    store.setState({ projects: { a: settings('a') } })
    save.mockResolvedValue({ ok: false, error: { message: '磁盘已满' } })
    await store.getState().setPermissionMode('a', 'smart-approval')
    expect(store.getState().projects.a.preferences.permissionMode).toBe('ask-every-time')
    expect(store.getState().errors.a).toBe('磁盘已满')
  })

  it('keeps late responses assigned to their project and suppresses concurrent writes', async () => {
    let finish!: (value: unknown) => void
    read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    store.setState({ projects: { a: settings('a'), b: settings('b') } })
    const pending = store.getState().load('a')
    await store.getState().setPermissionMode('a', 'smart-approval')
    expect(save).not.toHaveBeenCalled()
    finish({ ok: true, data: settings('a') })
    await pending
    expect(store.getState().projects.b).toEqual(settings('b'))
  })
})
