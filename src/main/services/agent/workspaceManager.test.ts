import { describe, expect, it } from 'vitest'
import type { WorkspaceBoundaryService } from './workspace'
import {
  clearWorkspaceBindings,
  clearSessionWorkspace,
  getSessionWorkspaceId,
  restoreSessionWorkspace,
  sameProjectPath
} from './workspaceManager'

describe('workspaceManager path matching', () => {
  it('matches persisted project paths across separators and trailing slashes', () => {
    expect(sameProjectPath('D:\\AIAGENT-New\\', 'D:/AIAGENT-New')).toBe(true)
  })

  it('does not bind a session to a different project', () => {
    expect(sameProjectPath('D:\\AIAGENT-New', 'D:\\AIAGENT-New-Evil')).toBe(false)
  })

  it('restores and verifies a persisted session binding after restart', async () => {
    const service = {
      listRecent: () => [{
        id: 'workspace-restored', name: 'repo', displayPath: 'D:\\repo',
        createdAt: 1, lastOpenedAt: 1
      }],
      activate: async () => ({
        id: 'workspace-restored', name: 'repo', displayPath: 'D:\\repo',
        createdAt: 1, lastOpenedAt: 2
      })
    } as unknown as WorkspaceBoundaryService
    const sessionId = 'session-restore-test'
    await expect(restoreSessionWorkspace(sessionId, 'D:/repo/', service))
      .resolves.toBe('workspace-restored')
    expect(getSessionWorkspaceId(sessionId)).toBe('workspace-restored')
    clearSessionWorkspace(sessionId)
  })

  it('clears every in-memory binding when a project is revoked', async () => {
    const workspace = { id: 'workspace-revoke', name: 'repo', displayPath: 'D:\\repo',
      createdAt: 1, lastOpenedAt: 1 }
    const service = { listRecent: () => [workspace], activate: async () => workspace } as unknown as WorkspaceBoundaryService
    await restoreSessionWorkspace('session-one', 'D:\\repo', service)
    await restoreSessionWorkspace('session-two', 'D:\\repo', service)
    clearWorkspaceBindings(workspace.id)
    expect(getSessionWorkspaceId('session-one')).toBeUndefined()
    expect(getSessionWorkspaceId('session-two')).toBeUndefined()
  })
})
