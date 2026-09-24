import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from './workspaceStore'

afterEach(() => {
  useWorkspaceStore.setState({ recent: [], loading: false, error: null })
  vi.unstubAllGlobals()
})

describe('workspace grant revocation', () => {
  it('removes only the revoked project from recent grants', async () => {
    useWorkspaceStore.setState({ recent: [
      { id: 'a', name: 'A', displayPath: 'D:\\a', createdAt: 1, lastOpenedAt: 1 },
      { id: 'b', name: 'B', displayPath: 'D:\\b', createdAt: 1, lastOpenedAt: 1 }
    ] })
    const revoke = vi.fn(async () => ({ ok: true as const, data: { workspaceId: 'a' } }))
    vi.stubGlobal('window', { agent: { workspace: { revoke } } })
    expect(await useWorkspaceStore.getState().revoke('a')).toBe(true)
    expect(useWorkspaceStore.getState().recent.map((workspace) => workspace.id)).toEqual(['b'])
  })

  it('keeps grants on a failed revocation', async () => {
    useWorkspaceStore.setState({ recent: [{ id: 'a', name: 'A', displayPath: 'D:\\a', createdAt: 1, lastOpenedAt: 1 }] })
    vi.stubGlobal('window', { agent: { workspace: { revoke: vi.fn(async () => ({
      ok: false as const, error: { code: 'WORKSPACE_ERROR', message: '撤销失败' }
    })) } } })
    expect(await useWorkspaceStore.getState().revoke('a')).toBe(false)
    expect(useWorkspaceStore.getState().recent).toHaveLength(1)
    expect(useWorkspaceStore.getState().error).toBe('撤销失败')
  })
})
