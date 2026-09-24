import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  revokeGrant: vi.fn(),
  clearBindings: vi.fn(),
  cancelTasks: vi.fn(),
  closeTerminals: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
    mocks.handlers.set(name, handler)
  } },
  BrowserWindow: {}, dialog: {}
}))
vi.mock('../db', () => ({ getStore: vi.fn() }))
vi.mock('../services/agent/workspaceManager', () => ({
  getWorkspaceService: () => ({ revokeGrant: mocks.revokeGrant }),
  clearWorkspaceBindings: mocks.clearBindings,
  activateSessionWorkspace: vi.fn(),
  onSessionWorkspaceSwitched: vi.fn()
}))
vi.mock('../services/agent/taskRuntimeManager', () => ({
  cancelTasksForSession: vi.fn(), cancelTasksForWorkspace: mocks.cancelTasks,
  getPatchWorkspaceService: vi.fn(), getTaskRuntime: vi.fn()
}))
vi.mock('./terminal', () => ({ closeWorkspaceTerminals: mocks.closeTerminals }))
vi.mock('../services/generationTasks', () => ({ cancelGeneration: vi.fn() }))

import { IPC } from '@shared/ipc'
import { configureTrustedIpcSender, setBusinessIpcAvailable } from './validation'
import { registerWorkspaceIpc } from './workspace'

function event(trusted = true): unknown {
  const frame = { url: trusted ? 'file:///D:/app/index.html' : 'file:///D:/other/index.html' }
  return { senderFrame: frame, sender: { mainFrame: frame, getURL: () => frame.url } }
}

describe('workspace authorization revocation', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    for (const fn of [mocks.revokeGrant, mocks.clearBindings, mocks.cancelTasks, mocks.closeTerminals]) fn.mockClear()
    configureTrustedIpcSender('file:///D:/app/index.html')
    setBusinessIpcAvailable(true)
    registerWorkspaceIpc()
  })

  it('revokes the grant and all active project capabilities', () => {
    const result = mocks.handlers.get(IPC.workspace.revoke)!(event(), workspaceId) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(mocks.revokeGrant).toHaveBeenCalledWith(workspaceId)
    expect(mocks.cancelTasks).toHaveBeenCalledWith(workspaceId, 'workspace_revoked')
    expect(mocks.clearBindings).toHaveBeenCalledWith(workspaceId)
    expect(mocks.closeTerminals).toHaveBeenCalledWith(workspaceId)
  })

  it('does not revoke from an untrusted sender or invalid ID', () => {
    expect((mocks.handlers.get(IPC.workspace.revoke)!(event(false), workspaceId) as { ok: boolean }).ok).toBe(false)
    expect((mocks.handlers.get(IPC.workspace.revoke)!(event(), 'bad') as { ok: boolean }).ok).toBe(false)
    expect(mocks.revokeGrant).not.toHaveBeenCalled()
  })
})
