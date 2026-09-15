import type { TaskEvent } from '../../../shared/agent'
import type { PluginHookEvent } from './pluginManifest'

export interface PluginHookWorker {
  invoke(toolName: string, args: unknown, context: { taskId: string; workspaceId?: string }, signal?: AbortSignal): Promise<unknown>
}

export interface PluginHookRegistration {
  pluginId: string
  version?: string
  event: PluginHookEvent
  name: string
  priority: number
  timeoutMs: number
  worker: PluginHookWorker
}

interface HookFailure {
  pluginId: string
  version?: string
  event: PluginHookEvent
  reasonCode: 'PLUGIN_HOOK_FAILED' | 'PLUGIN_HOOK_TIMEOUT'
  taskId: string
  workspaceId: string
}

interface ControllerOptions {
  succeeded?: (registration: PluginHookRegistration) => void
  failed?: (failure: HookFailure) => void
}

const ALLOWED_EVENTS = new Set<PluginHookEvent>(['task.created', 'task.status-changed', 'tool.completed'])

/** Observational hooks receive sanitized copies and can neither change task flow nor tool registration. */
export class PluginHookController {
  private queue: Promise<void> = Promise.resolve()
  private readonly workspaceByTask = new Map<string, string>()
  private readonly registrations: PluginHookRegistration[]

  constructor(registrations: PluginHookRegistration[], private readonly options: ControllerOptions = {}) {
    this.registrations = [...registrations].sort((left, right) =>
      right.priority - left.priority || left.pluginId.localeCompare(right.pluginId) || left.name.localeCompare(right.name))
  }

  observe(event: TaskEvent): void {
    if (!ALLOWED_EVENTS.has(event.type as PluginHookEvent)) return
    this.rememberWorkspace(event)
    const sanitized = sanitizeEvent(event)
    if (!sanitized) return
    this.queue = this.queue.then(async () => {
      const attempted = new Map<string, PluginHookRegistration>()
      const failed = new Set<string>()
      for (const registration of this.registrations) {
        if (registration.event !== event.type) continue
        attempted.set(registration.pluginId, registration)
        if (!await this.run(registration, event, sanitized)) failed.add(registration.pluginId)
      }
      for (const [pluginId, registration] of attempted) if (!failed.has(pluginId)) this.options.succeeded?.(registration)
    }).catch(() => undefined)
  }

  async drain(): Promise<void> { await this.queue }

  private async run(registration: PluginHookRegistration, event: TaskEvent, payload: unknown): Promise<boolean> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const execution = registration.worker.invoke(registration.name, payload, {
      taskId: event.taskId, workspaceId: this.workspaceByTask.get(event.taskId)
    }, controller.signal).then(() => 'success' as const, () => 'failure' as const)
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => { controller.abort('plugin_hook_timeout'); resolve('timeout') }, registration.timeoutMs)
      timer.unref?.()
    })
    const outcome = await Promise.race([execution, timeout])
    if (timer) clearTimeout(timer)
    if (outcome === 'success') return true
    try {
      this.options.failed?.({
        pluginId: registration.pluginId, version: registration.version, event: registration.event,
        reasonCode: outcome === 'timeout' ? 'PLUGIN_HOOK_TIMEOUT' : 'PLUGIN_HOOK_FAILED',
        taskId: event.taskId, workspaceId: this.workspaceByTask.get(event.taskId) ?? 'none'
      })
    } catch { /* hook diagnostics cannot affect task execution */ }
    return false
  }

  private rememberWorkspace(event: TaskEvent): void {
    if (event.type !== 'task.created' || !record(event.payload)) return
    const workspaceId = event.payload.workspaceId
    if (typeof workspaceId === 'string' && workspaceId.length <= 128 && !/[\u0000-\u001f]/.test(workspaceId)) {
      this.workspaceByTask.set(event.taskId, workspaceId)
    }
  }
}

function sanitizeEvent(event: TaskEvent): unknown {
  if (event.type === 'task.created') return { type: event.type, timestamp: event.timestamp, payload: {} }
  if (!record(event.payload)) return undefined
  if (event.type === 'task.status-changed') {
    return { type: event.type, timestamp: event.timestamp, payload: pickText(event.payload, ['from', 'to', 'reason']) }
  }
  if (event.type === 'tool.completed') {
    const payload: Record<string, unknown> = pickText(event.payload, ['callId', 'toolName', 'errorCode'])
    if (typeof event.payload.ok === 'boolean') payload.ok = event.payload.ok
    return { type: event.type, timestamp: event.timestamp, payload }
  }
  return undefined
}

function pickText(value: Record<string, unknown>, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of keys) {
    const item = value[key]
    if (typeof item === 'string' && item.length <= 256 && !/[\u0000-\u001f]/.test(item)) result[key] = item
  }
  return result
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
