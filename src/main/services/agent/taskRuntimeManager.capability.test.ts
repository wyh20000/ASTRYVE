import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { id: 42 } }]
  }
}))
vi.mock('../../db', () => ({
  getStore: () => ({ getSession: async (id: string) => id === 'session-capability' ? { id } : null })
}))

import {
  createCapabilityTask,
  flushTaskPersistence,
  initTaskRuntime,
  resetTaskRuntimeForTests
} from './taskRuntimeManager'

afterEach(async () => {
  await flushTaskPersistence()
  resetTaskRuntimeForTests()
})

describe('projectless capability task', () => {
  it('uses a reply-scoped isolated directory and removes it after completion', async () => {
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('astryve-capability-')))
    const runtime = initTaskRuntime()
    const task = await createCapabilityTask('session-capability', 42)
    expect(task.workspaceId).toBe('capability:session-capability')
    expect(task.permissionMode).toBe('ask-every-time')
    expect(task.environment).toBe('local')
    const created = (await readdir(tmpdir())).filter((name) =>
      name.startsWith('astryve-capability-') && !before.has(name))
    expect(created).toHaveLength(1)
    runtime.startTask(task.id)
    runtime.completeTask(task.id)
    await flushTaskPersistence()
    expect(await readdir(tmpdir())).not.toContain(created[0])
  })

  it('rejects a deleted session or closed owner before allocating a task', async () => {
    initTaskRuntime()
    await expect(createCapabilityTask('deleted-session', 42)).rejects.toThrow('会话不存在')
    await expect(createCapabilityTask('session-capability', 999)).rejects.toThrow('任务窗口已关闭')
  })
})
