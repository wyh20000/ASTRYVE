import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cancelAllAgentTasks,
  cancelTasksForOwner,
  cancelTasksForSession,
  getTaskRuntime,
  getToolRegistry,
  flushTaskPersistence,
  initTaskPersistence,
  initTaskRuntime,
  resetTaskRuntimeForTests
} from './taskRuntimeManager'

const tempDirs: string[] = []

afterEach(async () => {
  await flushTaskPersistence()
  resetTaskRuntimeForTests()
  await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
})

describe('taskRuntimeManager', () => {
  it('keeps lifecycle cancellation safe before initialization', () => {
    resetTaskRuntimeForTests()
    expect(cancelTasksForSession('session-1', 'test')).toBe(0)
    expect(cancelTasksForOwner(1, 'test')).toBe(0)
    expect(cancelAllAgentTasks('test')).toBe(0)
  })

  it('owns one runtime and cancels tasks through lifecycle indexes', () => {
    const runtime = initTaskRuntime()
    expect(getTaskRuntime()).toBe(runtime)
    expect(getToolRegistry().list().map((tool) => tool.name)).toEqual([
      'process.run', 'process.startService', 'process.stop',
      'docker.enableNetwork',
      'workspace.listFiles', 'workspace.readFile', 'workspace.searchText', 'workspace.findFiles',
      'workspace.discoverChecks',
      'workspace.patch', 'workspace.applyPatch',
      'git.status', 'git.diff', 'git.log', 'git.show'
    ])
    const task = runtime.createTask({
      sessionId: 'session-1',
      workspace: {
        id: 'workspace-1',
        rootPath: 'D:\\repo',
        realRootPath: 'D:\\repo',
        createdAt: 1
      },
      ownerWebContentsId: 10,
      permissionMode: 'ask-every-time',
      environment: 'docker'
    })
    runtime.startTask(task.id)
    expect(cancelTasksForOwner(10, 'window_closed')).toBe(1)
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('persists runtime events and terminal output through the manager', async () => {
    const dir = await fs.promises.mkdtemp(join(os.tmpdir(), 'ai-agent-manager-'))
    tempDirs.push(dir)
    const runtime = initTaskRuntime()
    await initTaskPersistence(dir)
    const task = runtime.createTask({
      sessionId: 'session-1',
      workspace: {
        id: 'workspace-1',
        rootPath: 'D:\\repo',
        realRootPath: 'D:\\repo',
        createdAt: 1
      },
      ownerWebContentsId: 10,
      permissionMode: 'ask-every-time',
      environment: 'docker'
    })
    runtime.startTask(task.id)
    runtime.appendOutput(task.id, 'model', 'final output')
    runtime.completeTask(task.id)
    await flushTaskPersistence()

    const persisted = JSON.parse(
      await fs.promises.readFile(join(dir, 'agent-task-journal.json'), 'utf8')
    ) as { tasks: Array<{ snapshot: { status: string } }>; events: Array<{ type: string }> }
    expect(persisted.tasks[0].snapshot.status).toBe('completed')
    expect(persisted.events.map((event) => event.type)).toContain('task.output')
    expect(persisted.events.at(-1)?.type).toBe('task.status-changed')
  })
})
