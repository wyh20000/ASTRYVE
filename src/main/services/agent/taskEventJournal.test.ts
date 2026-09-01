import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskEvent, TaskSnapshot } from '../../../shared/agent'
import { FileTaskEventStore, TaskEventJournal, type TaskEventStore } from './taskEventJournal'
import { cleanupStaleTaskResources, taskTempDirectory } from './taskRecovery'

const tempDirs: string[] = []

function snapshot(status: TaskSnapshot['status'] = 'queued'): TaskSnapshot {
  return {
    id: 'task-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    ownerWebContentsId: 1,
    permissionMode: 'ask-every-time',
    environment: 'docker',
    status,
    sequence: 1,
    createdAt: 100,
    updatedAt: 100
  }
}

function event(
  sequence: number,
  type: TaskEvent['type'],
  payload: unknown,
  timestamp = 100 + sequence
): TaskEvent {
  return {
    taskId: 'task-1',
    sessionId: 'session-1',
    sequence,
    type,
    timestamp,
    payload
  }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
})

describe('TaskEventJournal', () => {
  it('batches ordinary events but bypasses the delay for a terminal event', async () => {
    vi.useFakeTimers()
    const append = vi.fn(async (_events: TaskEvent[]) => undefined)
    const store: TaskEventStore = { append, recoverStaleTasks: async () => [] }
    const journal = new TaskEventJournal(store, 200)
    journal.record(event(1, 'task.created', snapshot()))
    journal.record(event(2, 'task.output', { stream: 'model', chunk: 'a' }))
    expect(append).not.toHaveBeenCalled()

    journal.record(event(3, 'task.status-changed', {
      from: 'running', to: 'completed', reason: 'completed'
    }))
    await journal.close()
    expect(append).toHaveBeenCalledTimes(1)
    expect(append.mock.calls[0][0]).toHaveLength(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('flushes a streaming batch after the throttle interval', async () => {
    vi.useFakeTimers()
    const append = vi.fn(async (_events: TaskEvent[]) => undefined)
    const journal = new TaskEventJournal({ append, recoverStaleTasks: async () => [] }, 200)
    journal.record(event(1, 'task.created', snapshot()))
    journal.record(event(2, 'task.output', { stream: 'model', chunk: 'a' }))
    await vi.advanceTimersByTimeAsync(199)
    expect(append).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await journal.close()
    expect(append).toHaveBeenCalledTimes(1)
  })
})

describe('FileTaskEventStore recovery', () => {
  it('atomically persists events, marks unfinished tasks stale, and cleans only their temp resources', async () => {
    const dir = await fs.promises.mkdtemp(join(os.tmpdir(), 'ai-agent-journal-'))
    tempDirs.push(dir)
    const journalPath = join(dir, 'tasks.json')
    const store = new FileTaskEventStore(journalPath)
    await store.append([
      event(1, 'task.created', snapshot()),
      event(2, 'task.status-changed', { from: 'queued', to: 'running', reason: 'start' })
    ])

    const taskRoot = join(dir, 'runtime', 'tasks')
    await fs.promises.mkdir(taskTempDirectory(taskRoot, 'task-1'), { recursive: true })
    await fs.promises.writeFile(join(taskTempDirectory(taskRoot, 'task-1'), 'partial.txt'), 'partial')
    await fs.promises.mkdir(taskTempDirectory(taskRoot, 'task-other'), { recursive: true })
    const interrupted = `${journalPath}.999.tmp`
    await fs.promises.writeFile(interrupted, 'partial')

    const restarted = new FileTaskEventStore(journalPath)
    expect(await restarted.cleanupInterruptedWrites()).toBe(1)
    const stale = await restarted.recoverStaleTasks(500)
    expect(stale).toEqual(['task-1'])
    expect(restarted.snapshotForTests().tasks[0]).toMatchObject({
      snapshot: { status: 'stale', sequence: 3, updatedAt: 500 },
      terminalReason: 'process_restarted',
      staleAt: 500
    })
    expect(await cleanupStaleTaskResources(taskRoot, stale)).toBe(1)
    expect(fs.existsSync(taskTempDirectory(taskRoot, 'task-1'))).toBe(false)
    expect(fs.existsSync(taskTempDirectory(taskRoot, 'task-other'))).toBe(true)
  })

  it('does not mark already terminal tasks stale', async () => {
    const dir = await fs.promises.mkdtemp(join(os.tmpdir(), 'ai-agent-journal-'))
    tempDirs.push(dir)
    const store = new FileTaskEventStore(join(dir, 'tasks.json'))
    await store.append([
      event(1, 'task.created', snapshot()),
      event(2, 'task.status-changed', { from: 'queued', to: 'cancelled', reason: 'user' })
    ])
    expect(await store.recoverStaleTasks(500)).toEqual([])
    expect(store.snapshotForTests().tasks[0].snapshot.status).toBe('cancelled')
  })

  it('removes a stale task link without deleting its external target', async () => {
    const dir = await fs.promises.mkdtemp(join(os.tmpdir(), 'ai-agent-recovery-'))
    tempDirs.push(dir)
    const taskRoot = join(dir, 'runtime', 'tasks')
    const external = join(dir, 'external')
    await fs.promises.mkdir(taskRoot, { recursive: true })
    await fs.promises.mkdir(external, { recursive: true })
    await fs.promises.writeFile(join(external, 'keep.txt'), 'keep')
    await fs.promises.symlink(
      external,
      taskTempDirectory(taskRoot, 'task-1'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )

    expect(await cleanupStaleTaskResources(taskRoot, ['task-1', '../external'])).toBe(1)
    expect(fs.existsSync(join(external, 'keep.txt'))).toBe(true)
    expect(fs.existsSync(taskTempDirectory(taskRoot, 'task-1'))).toBe(false)
  })
})
