import { describe, expect, it, vi } from 'vitest'
import type { TaskSnapshot } from '../../../shared/agent'
import { launchProjectTask, type ProjectTaskDependencies } from './projectTaskLauncher'

function setup() {
  const dependencies: ProjectTaskDependencies = {
    sessionExists: vi.fn(async () => true), activeWorkspace: vi.fn(() => 'project'),
    verifyWorkspace: vi.fn(async () => undefined),
    getGrant: () => ({ id: 'project', rootPath: 'D:/project', realRootPath: 'D:/project', createdAt: 1 }),
    getPreferences: () => ({ workspaceId: 'project', permissionMode: 'read-only', executionEnvironment: 'docker' }),
    getCapabilities: () => ({ dockerAvailable: true, localAvailable: false }),
    ownerAlive: () => true,
    createTask: vi.fn(() => ({ id: 'created' }) as TaskSnapshot)
  }
  return dependencies
}

describe('project task launch', () => {
  it('freezes current main-process preferences and authorized workspace into the task', async () => {
    const dependencies = setup()
    await expect(launchProjectTask('session', 5, dependencies)).resolves.toEqual({ id: 'created' })
    expect(dependencies.createTask).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session', ownerWebContentsId: 5, permissionMode: 'read-only', environment: 'docker',
      workspace: expect.objectContaining({ id: 'project' })
    }))
  })

  it('does not downgrade unavailable Docker to an available local backend', async () => {
    const dependencies = setup()
    dependencies.getCapabilities = () => ({ dockerAvailable: false, localAvailable: true })
    await expect(launchProjectTask('session', 5, dependencies)).rejects.toThrow('Docker 沙箱不可用')
    expect(dependencies.createTask).not.toHaveBeenCalled()
  })

  it.each(['deleted-session', 'switched-project', 'closed-window', 'revoked-grant'])(
    'rejects %s during asynchronous checks', async (failure) => {
      const dependencies = setup()
      dependencies.verifyWorkspace = async () => {
        if (failure === 'deleted-session') dependencies.sessionExists = async () => false
        if (failure === 'switched-project') dependencies.activeWorkspace = () => 'other'
        if (failure === 'closed-window') dependencies.ownerAlive = () => false
        if (failure === 'revoked-grant') dependencies.getGrant = () => undefined
      }
      await expect(launchProjectTask('session', 5, dependencies)).rejects.toThrow()
      expect(dependencies.createTask).not.toHaveBeenCalled()
    }
  )

  it('rejects corrupt permission preferences rather than granting broader access', async () => {
    const dependencies = setup()
    dependencies.getPreferences = () => ({ workspaceId: 'other', permissionMode: 'smart-approval', executionEnvironment: 'docker' })
    await expect(launchProjectTask('session', 5, dependencies)).rejects.toThrow('未授权')
    expect(dependencies.createTask).not.toHaveBeenCalled()
  })
})
