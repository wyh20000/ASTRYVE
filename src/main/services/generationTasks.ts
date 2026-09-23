import type { Message } from '@shared/types'

export interface GenerationTask {
  generationId: string
  controller: AbortController
  webContentsId: number
  timers: Set<ReturnType<typeof setTimeout>>
  snapshot?: Message
  onCancel?: (reason: string, snapshot?: Message) => void | Promise<void>
}

const tasks = new Map<string, GenerationTask>()
const pendingFinalizations = new Set<Promise<void>>()

export function beginGeneration(sessionId: string, webContentsId: number, generationId: string): GenerationTask {
  cancelGeneration(sessionId, 'replaced')
  const task: GenerationTask = {
    generationId,
    controller: new AbortController(),
    webContentsId,
    timers: new Set()
  }
  tasks.set(sessionId, task)
  return task
}

export function updateGenerationSnapshot(task: GenerationTask, message: Message): void {
  if (message.generationId !== task.generationId) return
  if (task.snapshot && (message.revision ?? 0) < (task.snapshot.revision ?? 0)) return
  task.snapshot = message
}

export function setGenerationCancelHandler(
  task: GenerationTask,
  handler: NonNullable<GenerationTask['onCancel']>
): void {
  task.onCancel = handler
}

export function isCurrentGeneration(sessionId: string, task: GenerationTask): boolean {
  return tasks.get(sessionId) === task && !task.controller.signal.aborted
}

export function addGenerationTimer(
  task: GenerationTask,
  callback: () => void,
  delayMs: number
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    task.timers.delete(timer)
    callback()
  }, delayMs)
  task.timers.add(timer)
  return timer
}

export function finishGeneration(sessionId: string, task: GenerationTask): void {
  if (tasks.get(sessionId) !== task) return
  for (const timer of task.timers) clearTimeout(timer)
  task.timers.clear()
  tasks.delete(sessionId)
}

export function cancelGeneration(sessionId: string, reason = 'user'): boolean {
  const task = tasks.get(sessionId)
  if (!task) return false
  tasks.delete(sessionId)
  for (const timer of task.timers) clearTimeout(timer)
  task.timers.clear()
  task.controller.abort(reason)
  const finalization = Promise.resolve(task.onCancel?.(reason, task.snapshot))
    .catch((error) => console.warn('[generation] cancellation finalization failed:', error))
    .finally(() => pendingFinalizations.delete(finalization))
  pendingFinalizations.add(finalization)
  return true
}

export async function flushGenerationFinalizations(): Promise<void> {
  await Promise.allSettled([...pendingFinalizations])
}

export function cancelGenerationsForWebContents(webContentsId: number, reason = 'window_closed'): void {
  for (const [sessionId, task] of tasks) {
    if (task.webContentsId === webContentsId) cancelGeneration(sessionId, reason)
  }
}

export function cancelAllGenerations(reason = 'app_quit'): void {
  for (const sessionId of [...tasks.keys()]) cancelGeneration(sessionId, reason)
}
