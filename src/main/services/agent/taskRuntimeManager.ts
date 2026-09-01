import { join } from 'node:path'
import { TaskRuntime } from './taskRuntime'
import { ToolRegistry } from './toolRegistry'
import { FileTaskEventStore, TaskEventJournal } from './taskEventJournal'
import { cleanupStaleTaskResources } from './taskRecovery'

let registry: ToolRegistry | null = null
let runtime: TaskRuntime | null = null
let journal: TaskEventJournal | null = null
let unsubscribeJournal: (() => void) | null = null

export function initTaskRuntime(): TaskRuntime {
  unsubscribeJournal?.()
  unsubscribeJournal = null
  journal = null
  registry = new ToolRegistry()
  runtime = new TaskRuntime(registry)
  return runtime
}

export async function initTaskPersistence(userDataPath: string): Promise<{
  staleTasks: number
  removedResources: number
  removedInterruptedWrites: number
}> {
  const activeRuntime = getTaskRuntime()
  const store = new FileTaskEventStore(join(userDataPath, 'agent-task-journal.json'))
  const removedInterruptedWrites = await store.cleanupInterruptedWrites()
  const staleTaskIds = await store.recoverStaleTasks()
  const removedResources = await cleanupStaleTaskResources(
    join(userDataPath, 'agent-runtime', 'tasks'),
    staleTaskIds
  )
  journal = new TaskEventJournal(store)
  unsubscribeJournal?.()
  unsubscribeJournal = activeRuntime.subscribe((event) => journal?.record(event))
  return { staleTasks: staleTaskIds.length, removedResources, removedInterruptedWrites }
}

export function getTaskRuntime(): TaskRuntime {
  if (!runtime) throw new Error('Task runtime not initialized')
  return runtime
}

export function getToolRegistry(): ToolRegistry {
  if (!registry) throw new Error('Tool registry not initialized')
  return registry
}

export function cancelTasksForSession(sessionId: string, reason: string): number {
  return runtime?.cancelSession(sessionId, reason) ?? 0
}

export function cancelTasksForOwner(ownerWebContentsId: number, reason: string): number {
  return runtime?.cancelOwner(ownerWebContentsId, reason) ?? 0
}

export function cancelAllAgentTasks(reason: string): number {
  return runtime?.cancelAll(reason) ?? 0
}

export async function flushTaskPersistence(): Promise<void> {
  await journal?.close()
}

export function resetTaskRuntimeForTests(): void {
  unsubscribeJournal?.()
  unsubscribeJournal = null
  void journal?.close()
  journal = null
  runtime?.cancelAll('test_reset')
  runtime = null
  registry = null
}
