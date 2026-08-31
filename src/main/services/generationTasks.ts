export interface GenerationTask {
  controller: AbortController
  webContentsId: number
  timers: Set<ReturnType<typeof setTimeout>>
}

const tasks = new Map<string, GenerationTask>()

export function beginGeneration(sessionId: string, webContentsId: number): GenerationTask {
  cancelGeneration(sessionId, 'replaced')
  const task: GenerationTask = {
    controller: new AbortController(),
    webContentsId,
    timers: new Set()
  }
  tasks.set(sessionId, task)
  return task
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
  return true
}

export function cancelGenerationsForWebContents(webContentsId: number, reason = 'window_closed'): void {
  for (const [sessionId, task] of tasks) {
    if (task.webContentsId === webContentsId) cancelGeneration(sessionId, reason)
  }
}

export function cancelAllGenerations(reason = 'app_quit'): void {
  for (const sessionId of [...tasks.keys()]) cancelGeneration(sessionId, reason)
}
