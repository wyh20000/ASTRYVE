import { randomUUID } from 'node:crypto'
import type {
  ExecutionEnvironment,
  PermissionMode,
  TaskEvent,
  TaskOutputPayload,
  TaskOutputStream,
  TaskSnapshot,
  ToolInvocation,
  ToolResult,
  WorkspaceGrant
} from '../../../shared/agent'
import { NativeToolCallError, parseNativeFunctionToolCall } from './nativeToolCall'
import { DuplicateToolCallError, TaskStateMachine } from './taskStateMachine'
import { ToolRegistry, ToolRegistryError } from './toolRegistry'
import {
  hasSafeValueShape,
  isEntityId,
  isExecutionEnvironment,
  isPermissionMode
} from './validation'

const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_TOOL_TIMEOUT_MS = 60 * 1000
const DEFAULT_OUTPUT_FLUSH_MS = 50
const DEFAULT_OUTPUT_CHUNK_BYTES = 16 * 1024
const DEFAULT_OUTPUT_PENDING_BYTES = 256 * 1024
const DEFAULT_OUTPUT_TOTAL_BYTES = 1024 * 1024
export const MAX_TIMEOUT_MS = 2_147_483_647

type TimerHandle = ReturnType<typeof setTimeout>

interface QueuedToolCall {
  invocation: ToolInvocation
  resolve: (result: ToolResult<unknown>) => void
}

interface RuntimeTask {
  machine: TaskStateMachine
  workspace: WorkspaceGrant
  ownerWebContentsId: number
  controller: AbortController
  registry: ToolRegistry
  dispose?: () => void | Promise<void>
  taskTimeoutMs: number
  toolTimeoutMs: number
  dockerImageId?: string
  taskTimeout: TimerHandle | undefined
  queue: QueuedToolCall[]
  processing: boolean
  finished: boolean
  output: {
    pending: Map<TaskOutputStream, string>
    pendingBytes: number
    acceptedBytes: number
    truncated: boolean
    truncationNotified: boolean
    timer: TimerHandle | undefined
  }
}

export interface CreateTaskInput {
  sessionId: string
  workspace: WorkspaceGrant
  ownerWebContentsId: number
  permissionMode: PermissionMode
  environment: ExecutionEnvironment
  dockerImageId?: string
  taskTimeoutMs?: number
  toolTimeoutMs?: number
  toolDefinitions?: readonly import('../../../shared/agent').ToolDefinition<any, any>[]
  pluginIds?: string[]
  pluginVersions?: Record<string, string | undefined>
  dispose?: () => void | Promise<void>
}

export interface TaskRuntimeOptions {
  defaultTaskTimeoutMs?: number
  defaultToolTimeoutMs?: number
  now?: () => number
  createTaskId?: () => string
  outputFlushMs?: number
  outputChunkBytes?: number
  outputPendingBytes?: number
  outputTotalBytes?: number
}

export type TaskRuntimeErrorCode =
  | 'INVALID_TASK_INPUT'
  | 'DUPLICATE_SESSION_TASK'
  | 'TASK_NOT_FOUND'
  | 'TASK_NOT_RUNNING'
  | 'TASK_BUSY'

export class TaskRuntimeError extends Error {
  constructor(readonly code: TaskRuntimeErrorCode, message: string) {
    super(message)
    this.name = 'TaskRuntimeError'
  }
}

/**
 * Main-process-only task coordinator. It is the sole source of task event
 * sequencing and trusted tool context. Provider output can only describe a
 * function name, call id and JSON arguments.
 */
export class TaskRuntime {
  private readonly tasks = new Map<string, RuntimeTask>()
  private readonly sessionTasks = new Map<string, string>()
  private readonly workspaceTasks = new Map<string, Set<string>>()
  private readonly ownerTasks = new Map<number, Set<string>>()
  private readonly listeners = new Set<(event: TaskEvent) => void>()
  private readonly now: () => number
  private readonly createTaskId: () => string
  private readonly defaultTaskTimeoutMs: number
  private readonly defaultToolTimeoutMs: number
  private readonly outputFlushMs: number
  private readonly outputChunkBytes: number
  private readonly outputPendingBytes: number
  private readonly outputTotalBytes: number

  constructor(
    private readonly registry: ToolRegistry,
    options: TaskRuntimeOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.createTaskId = options.createTaskId ?? (() => `task-${randomUUID()}`)
    this.defaultTaskTimeoutMs = options.defaultTaskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
    this.defaultToolTimeoutMs = options.defaultToolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
    this.outputFlushMs = options.outputFlushMs ?? DEFAULT_OUTPUT_FLUSH_MS
    this.outputChunkBytes = options.outputChunkBytes ?? DEFAULT_OUTPUT_CHUNK_BYTES
    this.outputPendingBytes = options.outputPendingBytes ?? DEFAULT_OUTPUT_PENDING_BYTES
    this.outputTotalBytes = options.outputTotalBytes ?? DEFAULT_OUTPUT_TOTAL_BYTES
    if (
      !isPositiveTimeout(this.outputFlushMs) ||
      !isPositiveLimit(this.outputChunkBytes) ||
      !isPositiveLimit(this.outputPendingBytes) ||
      !isPositiveLimit(this.outputTotalBytes)
    ) {
      throw new TaskRuntimeError('INVALID_TASK_INPUT', 'Task output limits are invalid')
    }
  }

  subscribe(listener: (event: TaskEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  createTask(input: CreateTaskInput): TaskSnapshot {
    this.validateCreateInput(input)
    if (this.sessionTasks.has(input.sessionId)) {
      throw new TaskRuntimeError(
        'DUPLICATE_SESSION_TASK',
        `Session already has an active task: ${input.sessionId}`
      )
    }

    const taskId = this.nextTaskId()
    const taskTimeoutMs = input.taskTimeoutMs ?? this.defaultTaskTimeoutMs
    const toolTimeoutMs = input.toolTimeoutMs ?? this.defaultToolTimeoutMs
    if (!isPositiveTimeout(taskTimeoutMs) || !isPositiveTimeout(toolTimeoutMs)) {
      throw new TaskRuntimeError('INVALID_TASK_INPUT', 'Task timeouts must be positive finite values')
    }

    const machine = new TaskStateMachine({
      id: taskId,
      sessionId: input.sessionId,
      workspaceId: input.workspace.id,
      ownerWebContentsId: input.ownerWebContentsId,
      permissionMode: input.permissionMode,
      environment: input.environment,
      dockerImageId: input.dockerImageId,
      pluginIds: input.pluginIds,
      pluginVersions: input.pluginVersions,
      now: this.now()
    })
    const task: RuntimeTask = {
      machine,
      workspace: { ...input.workspace },
      ownerWebContentsId: input.ownerWebContentsId,
      controller: new AbortController(),
      registry: this.registry.createScope(input.toolDefinitions),
      dispose: input.dispose,
      taskTimeoutMs,
      toolTimeoutMs,
      dockerImageId: input.dockerImageId,
      taskTimeout: undefined,
      queue: [],
      processing: false,
      finished: false,
      output: {
        pending: new Map(),
        pendingBytes: 0,
        acceptedBytes: 0,
        truncated: false,
        truncationNotified: false,
        timer: undefined
      }
    }

    this.tasks.set(taskId, task)
    this.sessionTasks.set(input.sessionId, taskId)
    this.addIndex(this.workspaceTasks, input.workspace.id, taskId)
    this.addIndex(this.ownerTasks, input.ownerWebContentsId, taskId)
    task.taskTimeout = setTimeout(() => this.cancelTask(taskId, 'task_timeout'), taskTimeoutMs)
    this.emitCreated(task)
    return task.machine.snapshot
  }

  startTask(taskId: string): TaskSnapshot {
    const task = this.requireTask(taskId)
    this.emitTransition(task, 'running', 'runtime_started')
    return task.machine.snapshot
  }

  completeTask(taskId: string): boolean {
    const task = this.requireTask(taskId)
    if (task.processing || task.queue.length > 0) {
      throw new TaskRuntimeError('TASK_BUSY', 'Cannot complete a task with pending tool calls')
    }
    this.finish(task, 'completed', 'completed')
    return true
  }

  async submitNativeToolCall(taskId: string, providerCall: unknown): Promise<ToolResult<unknown>> {
    const task = this.requireTask(taskId)
    if (task.machine.snapshot.status !== 'running') {
      throw new TaskRuntimeError('TASK_NOT_RUNNING', 'Tool calls require a running task')
    }

    let nativeCall
    try {
      nativeCall = parseNativeFunctionToolCall(providerCall)
    } catch (error) {
      return this.rejectToolCall(task, error)
    }

    try {
      task.machine.registerToolCall(nativeCall.callId)
    } catch (error) {
      return this.rejectToolCall(task, error)
    }

    // Only this method constructs the full invocation. Task and execution
    // context never come from the model/provider payload.
    const snapshot = task.machine.snapshot
    const invocation: ToolInvocation = {
      taskId: snapshot.id,
      callId: nativeCall.callId,
      toolName: nativeCall.toolName,
      args: nativeCall.args,
      workspaceId: task.workspace.id,
      environment: snapshot.environment,
      permissionMode: snapshot.permissionMode
    }

    try {
      task.registry.validate(invocation)
    } catch (error) {
      return this.rejectToolCall(task, error)
    }

    this.publish(task.machine.emit('tool.requested', {
      callId: invocation.callId,
      toolName: invocation.toolName
    }, this.now()))
    return new Promise<ToolResult<unknown>>((resolve) => {
      task.queue.push({ invocation, resolve })
      void this.drain(task)
    })
  }

  cancelTask(taskId: string, reason = 'user'): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.finished) return false
    this.finish(task, 'cancelled', reason)
    return true
  }

  failTask(taskId: string, reason = 'runtime_failed'): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.finished) return false
    this.finish(task, 'failed', reason)
    return true
  }

  appendOutput(taskId: string, stream: TaskOutputStream, chunk: string): void {
    const task = this.requireTask(taskId)
    if (!['model', 'reasoning', 'stdout', 'stderr'].includes(stream)) {
      throw new TaskRuntimeError('INVALID_TASK_INPUT', 'Task output stream is invalid')
    }
    if (typeof chunk !== 'string' || chunk.length === 0) return

    const totalRemaining = this.outputTotalBytes - task.output.acceptedBytes
    const pendingRemaining = this.outputPendingBytes - task.output.pendingBytes
    const accepted = truncateUtf8(chunk, Math.max(0, Math.min(totalRemaining, pendingRemaining)))
    if (accepted) {
      const bytes = Buffer.byteLength(accepted, 'utf8')
      task.output.pending.set(stream, (task.output.pending.get(stream) ?? '') + accepted)
      task.output.pendingBytes += bytes
      task.output.acceptedBytes += bytes
    }
    if (accepted !== chunk) task.output.truncated = true
    if (!task.output.timer) {
      task.output.timer = setTimeout(() => {
        task.output.timer = undefined
        if (this.isActive(task)) this.flushOutput(task)
      }, this.outputFlushMs)
    }
  }

  flushTaskOutput(taskId: string): void {
    this.flushOutput(this.requireTask(taskId))
  }

  cancelSession(sessionId: string, reason = 'session_cancelled'): number {
    const taskId = this.sessionTasks.get(sessionId)
    return taskId && this.cancelTask(taskId, reason) ? 1 : 0
  }

  cancelWorkspace(workspaceId: string, reason = 'workspace_cancelled'): number {
    return this.cancelIndexed(this.workspaceTasks.get(workspaceId), reason)
  }

  cancelOwner(ownerWebContentsId: number, reason = 'owner_cancelled'): number {
    return this.cancelIndexed(this.ownerTasks.get(ownerWebContentsId), reason)
  }

  cancelAll(reason = 'runtime_cancelled'): number {
    let cancelled = 0
    for (const taskId of [...this.tasks.keys()]) {
      if (this.cancelTask(taskId, reason)) cancelled += 1
    }
    return cancelled
  }

  getTaskSnapshot(taskId: string): TaskSnapshot | undefined {
    return this.tasks.get(taskId)?.machine.snapshot
  }

  setWaitingApproval(taskId: string, waiting: boolean): void {
    const task = this.tasks.get(taskId)
    if (!task || !this.isActive(task)) return
    const status = task.machine.snapshot.status
    if (waiting && status === 'running') this.emitTransition(task, 'waiting-approval', 'approval_required')
    if (!waiting && status === 'waiting-approval') this.emitTransition(task, 'running', 'approval_resolved')
  }

  getTaskSignal(taskId: string): AbortSignal {
    return this.requireTask(taskId).controller.signal
  }

  listNativeFunctionTools(taskId: string, allowedNames?: ReadonlySet<string>) {
    return this.requireTask(taskId).registry.listNativeFunctionTools(allowedNames)
  }

  getTaskIdForSession(sessionId: string): string | undefined {
    return this.sessionTasks.get(sessionId)
  }

  get activeTaskCount(): number {
    return this.tasks.size
  }

  private async drain(task: RuntimeTask): Promise<void> {
    if (task.processing) return
    task.processing = true
    let current: QueuedToolCall | undefined
    try {
      while (this.isActive(task) && task.queue.length > 0) {
        current = task.queue.shift()
        if (!current) continue
        const result = await this.executeTool(task, current.invocation)

        if (!this.isActive(task)) {
          current.resolve(cancelledResult())
          current = undefined
          break
        }

        this.publish(task.machine.emit('tool.completed', {
          callId: current.invocation.callId,
          toolName: current.invocation.toolName,
          ok: result.ok,
          errorCode: result.error?.code
        }, this.now()))
        current.resolve(result)
        current = undefined

        if (!result.ok && isTerminalToolFailureCode(result.error?.code)) {
          this.finish(task, 'failed', result.error?.code === 'TOOL_TIMEOUT' ? 'tool_timeout' : 'tool_failed')
          break
        }
      }
    } catch (error) {
      if (current) {
        current.resolve(runtimeFailureResult(error))
        current = undefined
      }
      if (this.isActive(task)) this.finish(task, 'failed', 'runtime_error')
    } finally {
      task.processing = false
      if (current) current.resolve(cancelledResult())
      if (!this.isActive(task)) this.resolveQueuedCalls(task, cancelledResult())
    }
  }

  private async executeTool(task: RuntimeTask, invocation: ToolInvocation): Promise<ToolResult<unknown>> {
    if (!this.isActive(task) || task.controller.signal.aborted) return cancelledResult()

    const controller = new AbortController()
    const onTaskAbort = () => controller.abort(task.controller.signal.reason)
    task.controller.signal.addEventListener('abort', onTaskAbort, { once: true })

    let timeout: TimerHandle | undefined
    try {
      const execution = task.registry
        .execute(invocation, {
          taskId: invocation.taskId,
          callId: invocation.callId,
          workspace: task.workspace,
          environment: invocation.environment,
          permissionMode: invocation.permissionMode,
          dockerImageId: task.dockerImageId,
          signal: controller.signal
        })
        .then((result) => ({ kind: 'result' as const, result }))
        .catch((error: unknown) => ({ kind: 'error' as const, error }))
      const timeoutResult = new Promise<{ kind: 'timeout' }>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort('tool_timeout')
          resolve({ kind: 'timeout' })
        }, task.toolTimeoutMs)
      })
      const cancellation = createCancellationRace(task.controller.signal)
      const outcome = await Promise.race([execution, timeoutResult, cancellation.promise])
      cancellation.cleanup()

      if (!this.isActive(task) || task.controller.signal.aborted || outcome.kind === 'cancelled') {
        return cancelledResult()
      }
      if (outcome.kind === 'timeout') return timeoutResultFor(invocation.callId)
      if (outcome.kind === 'error') return executionErrorResult(outcome.error)
      return normalizeToolResult(outcome.result)
    } finally {
      if (timeout) clearTimeout(timeout)
      task.controller.signal.removeEventListener('abort', onTaskAbort)
    }
  }

  private rejectToolCall(task: RuntimeTask, error: unknown): ToolResult<unknown> {
    const result = rejectedToolResult(error)
    this.finish(task, 'failed', 'invalid_tool_call')
    return result
  }

  private finish(task: RuntimeTask, status: 'completed' | 'failed' | 'cancelled', reason: string): void {
    if (!this.isActive(task)) return
    this.flushOutput(task)
    if (!this.isActive(task)) return
    const current = task.machine.snapshot.status
    if (status === 'cancelled' && current !== 'stopping') {
      this.emitTransition(task, 'stopping', reason)
    }
    this.emitTransition(task, status, reason)
    task.finished = true
    if (task.taskTimeout) clearTimeout(task.taskTimeout)
    task.taskTimeout = undefined
    if (task.output.timer) clearTimeout(task.output.timer)
    task.output.timer = undefined
    task.controller.abort(reason)
    void Promise.resolve(task.dispose?.()).catch(() => undefined)
    this.removeTask(task)
    this.resolveQueuedCalls(task, cancelledResult())
  }

  private emitCreated(task: RuntimeTask): void {
    const created = task.machine.emit('task.created', undefined, this.now())
    this.publish({ ...created, payload: task.machine.snapshot })
  }

  private flushOutput(task: RuntimeTask): void {
    if (task.output.timer) clearTimeout(task.output.timer)
    task.output.timer = undefined
    const pendingByStream = [...task.output.pending.entries()]
    task.output.pending.clear()
    task.output.pendingBytes = 0
    for (const [stream, pending] of pendingByStream) {
      let rest = pending
      while (rest.length > 0) {
        const chunk = truncateUtf8(rest, this.outputChunkBytes)
        if (!chunk) break
        const payload: TaskOutputPayload = { stream, chunk }
        this.publish(task.machine.emit('task.output', payload, this.now()))
        if (!this.isActive(task)) return
        rest = rest.slice(chunk.length)
      }
    }
    if (task.output.truncated && !task.output.truncationNotified) {
      task.output.truncationNotified = true
      this.publish(task.machine.emit('task.notice', {
        code: 'OUTPUT_TRUNCATED',
        message: '任务输出超过限制，后续内容已截断'
      }, this.now()))
    }
  }

  private emitTransition(task: RuntimeTask, status: TaskSnapshot['status'], reason: string): void {
    this.publish(task.machine.transition(status, reason, this.now()))
  }

  private publish(event: TaskEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Renderer or observer failures must not affect task execution.
      }
    }
  }

  private requireTask(taskId: string): RuntimeTask {
    const task = this.tasks.get(taskId)
    if (!task || task.finished) throw new TaskRuntimeError('TASK_NOT_FOUND', `Task not found: ${taskId}`)
    return task
  }

  private isActive(task: RuntimeTask): boolean {
    const id = task.machine.snapshot.id
    return !task.finished && this.tasks.get(id) === task
  }

  private nextTaskId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const taskId = this.createTaskId()
      if (isEntityId(taskId) && !this.tasks.has(taskId)) return taskId
    }
    throw new TaskRuntimeError('INVALID_TASK_INPUT', 'Unable to allocate a valid task id')
  }

  private validateCreateInput(input: CreateTaskInput): void {
    const workspace = input.workspace
    if (
      !isEntityId(input.sessionId) ||
      !workspace ||
      !isEntityId(workspace.id) ||
      typeof workspace.rootPath !== 'string' ||
      workspace.rootPath.trim().length === 0 ||
      typeof workspace.realRootPath !== 'string' ||
      workspace.realRootPath.trim().length === 0 ||
      !Number.isSafeInteger(workspace.createdAt) ||
      workspace.createdAt < 0 ||
      !Number.isSafeInteger(input.ownerWebContentsId) ||
      input.ownerWebContentsId <= 0 ||
      !isPermissionMode(input.permissionMode) ||
      !isExecutionEnvironment(input.environment) ||
      (input.dockerImageId !== undefined && !/^sha256:[a-f0-9]{64}$/i.test(input.dockerImageId)) ||
      (input.environment !== 'docker' && input.dockerImageId !== undefined) ||
      (input.pluginIds !== undefined && (!Array.isArray(input.pluginIds) || input.pluginIds.some((id) => typeof id !== 'string')))
    ) {
      throw new TaskRuntimeError('INVALID_TASK_INPUT', 'Task context is invalid')
    }
  }

  private addIndex<TKey>(index: Map<TKey, Set<string>>, key: TKey, taskId: string): void {
    const ids = index.get(key) ?? new Set<string>()
    ids.add(taskId)
    index.set(key, ids)
  }

  private cancelIndexed(taskIds: Set<string> | undefined, reason: string): number {
    if (!taskIds) return 0
    let cancelled = 0
    for (const taskId of [...taskIds]) {
      if (this.cancelTask(taskId, reason)) cancelled += 1
    }
    return cancelled
  }

  private removeTask(task: RuntimeTask): void {
    const snapshot = task.machine.snapshot
    this.tasks.delete(snapshot.id)
    if (this.sessionTasks.get(snapshot.sessionId) === snapshot.id) {
      this.sessionTasks.delete(snapshot.sessionId)
    }
    this.removeIndex(this.workspaceTasks, snapshot.workspaceId, snapshot.id)
    this.removeIndex(this.ownerTasks, task.ownerWebContentsId, snapshot.id)
  }

  private removeIndex<TKey>(index: Map<TKey, Set<string>>, key: TKey, taskId: string): void {
    const ids = index.get(key)
    if (!ids) return
    ids.delete(taskId)
    if (ids.size === 0) index.delete(key)
  }

  private resolveQueuedCalls(task: RuntimeTask, result: ToolResult<unknown>): void {
    for (const queued of task.queue.splice(0)) queued.resolve(result)
  }
}

function isPositiveTimeout(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS
}

function isPositiveLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) low = middle
    else high = middle - 1
  }
  return value.slice(0, low)
}

function createCancellationRace(signal: AbortSignal): {
  promise: Promise<{ kind: 'cancelled' }>
  cleanup: () => void
} {
  if (signal.aborted) return { promise: Promise.resolve({ kind: 'cancelled' }), cleanup: () => undefined }
  let onAbort: (() => void) | undefined
  const promise = new Promise<{ kind: 'cancelled' }>((resolve) => {
    onAbort = () => resolve({ kind: 'cancelled' })
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return {
    promise,
    cleanup: () => {
      if (!onAbort) return
      signal.removeEventListener('abort', onAbort)
      onAbort = undefined
    }
  }
}

function normalizeToolResult(result: unknown): ToolResult<unknown> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return invalidToolResult()
  const candidate = result as Record<string, unknown>
  if (typeof candidate.ok !== 'boolean') return invalidToolResult()
  if (candidate.ok) {
    if (candidate.error !== undefined) return invalidToolResult()
    if (candidate.value !== undefined && !hasSafeValueShape(candidate.value)) {
      return invalidToolResult()
    }
    return { ok: true, value: candidate.value }
  }
  if (candidate.error === undefined) {
    return { ok: false, error: { code: 'TOOL_FAILED', message: 'Tool returned an unsuccessful result' } }
  }
  if (!candidate.error || typeof candidate.error !== 'object' || Array.isArray(candidate.error)) {
    return invalidToolResult()
  }
  const error = candidate.error as Record<string, unknown>
  if (
    typeof error.code !== 'string' ||
    error.code.trim().length === 0 ||
    error.code.length > 128 ||
    typeof error.message !== 'string' ||
    error.message.trim().length === 0 ||
    error.message.length > 100_000
  ) {
    return invalidToolResult()
  }
  return {
    ok: false,
    error: { code: error.code, message: error.message }
  }
}

function invalidToolResult(): ToolResult<unknown> {
  return { ok: false, error: { code: 'INVALID_TOOL_RESULT', message: 'Tool returned an invalid result' } }
}

function cancelledResult(): ToolResult<unknown> {
  return { ok: false, error: { code: 'TASK_CANCELLED', message: 'Task was cancelled' } }
}

function timeoutResultFor(callId: string): ToolResult<unknown> {
  return { ok: false, error: { code: 'TOOL_TIMEOUT', message: `Tool call timed out: ${callId}` } }
}

function executionErrorResult(error: unknown): ToolResult<unknown> {
  return {
    ok: false,
    error: {
      code: 'TOOL_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : 'Tool execution failed'
    }
  }
}

function runtimeFailureResult(error: unknown): ToolResult<unknown> {
  return {
    ok: false,
    error: {
      code: 'TOOL_RUNTIME_ERROR',
      message: error instanceof Error ? error.message : 'Task runtime failed while processing a tool call'
    }
  }
}

function rejectedToolResult(error: unknown): ToolResult<unknown> {
  const code = error instanceof NativeToolCallError || error instanceof ToolRegistryError
    ? error.code
    : error instanceof DuplicateToolCallError
      ? 'DUPLICATE_CALL_ID'
      : 'INVALID_TOOL_CALL'
  return {
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : 'Tool call was rejected'
    }
  }
}

/** Failures that indicate cancellation or a broken execution boundary. */
export function isTerminalToolFailureCode(code: string | undefined): boolean {
  return code === 'TASK_CANCELLED' ||
    code === 'TOOL_TIMEOUT' ||
    code === 'INVALID_TOOL_RESULT' ||
    code === 'TOOL_EXECUTION_FAILED' ||
    code === 'TOOL_RUNTIME_ERROR' ||
    code === 'INVALID_ENVELOPE' ||
    code === 'INVALID_JSON' ||
    code === 'UNSAFE_ARGUMENTS' ||
    code === 'INVALID_INVOCATION' ||
    code === 'UNKNOWN_TOOL' ||
    code === 'DUPLICATE_CALL_ID' ||
    code === 'INVALID_TOOL_CALL'
}
