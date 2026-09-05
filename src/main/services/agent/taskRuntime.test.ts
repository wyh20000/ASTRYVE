import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreateTaskInput } from './taskRuntime'
import type { ToolDefinition, ToolExecutionContext, ToolResult } from '../../../shared/agent'
import { MAX_TIMEOUT_MS, TaskRuntime, TaskRuntimeError } from './taskRuntime'
import { ToolRegistry } from './toolRegistry'

const workspace = {
  id: 'workspace-1',
  rootPath: 'D:\\repo',
  realRootPath: 'D:\\repo',
  createdAt: 1
}

function nativeCall(callId = 'call-1', name = 'test.echo', argumentsValue = '{"value":"ok"}') {
  return { type: 'function', id: callId, function: { name, arguments: argumentsValue } }
}

function tool(
  execute: (input: { value: string }, context: ToolExecutionContext) => Promise<ToolResult<unknown>>
): ToolDefinition<{ value: string }, unknown> {
  return {
    name: 'test.echo',
    operation: 'fs.read',
    description: 'Test-only no-op tool',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false
    },
    validateArgs: (input): input is { value: string } =>
      !!input && typeof input === 'object' && typeof (input as { value?: unknown }).value === 'string',
    execute
  }
}

function createRuntime(
  execute: ToolDefinition<{ value: string }, unknown>['execute'] = vi.fn(async () => ({
    ok: true,
    value: 'ok'
  })),
  options: ConstructorParameters<typeof TaskRuntime>[1] = {}
) {
  const registry = new ToolRegistry()
  registry.register(tool(execute))
  let id = 0
  const runtime = new TaskRuntime(registry, {
    createTaskId: () => `task-${++id}`,
    ...options
  })
  return { runtime, execute }
}

function createAndStart(runtime: TaskRuntime, overrides: Partial<Parameters<TaskRuntime['createTask']>[0]> = {}) {
  const task = runtime.createTask({
    sessionId: 'session-1',
    workspace,
    ownerWebContentsId: 101,
    permissionMode: 'ask-every-time',
    environment: 'docker',
    ...overrides
  })
  runtime.startTask(task.id)
  return task
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function expectRuntimeError(action: () => unknown, code: TaskRuntimeError['code']): void {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(TaskRuntimeError)
  expect((caught as TaskRuntimeError).code).toBe(code)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TaskRuntime', () => {
  it('creates ordered runtime-owned events and cleans all active mappings on completion', () => {
    const { runtime } = createRuntime()
    const events: Array<{ type: string; sequence: number }> = []
    runtime.subscribe((event) => events.push(event))
    const task = createAndStart(runtime)

    expect(events.map((event) => event.type)).toEqual(['task.created', 'task.status-changed'])
    expect(events.map((event) => event.sequence)).toEqual([1, 2])
    expect(runtime.getTaskIdForSession('session-1')).toBe(task.id)
    expect(runtime.completeTask(task.id)).toBe(true)
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3])
    expect(runtime.activeTaskCount).toBe(0)
    expect(runtime.getTaskSnapshot(task.id)).toBeUndefined()
    expect(runtime.getTaskIdForSession('session-1')).toBeUndefined()
  })

  it('enforces one active task per session and permits a new task after cleanup', () => {
    const { runtime } = createRuntime()
    const task = createAndStart(runtime)
    expectRuntimeError(() => runtime.createTask({
      sessionId: 'session-1', workspace, ownerWebContentsId: 101,
      permissionMode: 'ask-every-time', environment: 'docker'
    }), 'DUPLICATE_SESSION_TASK')

    runtime.cancelTask(task.id)
    expect(createAndStart(runtime).id).toBe('task-2')
  })

  it('constructs the invocation from trusted task context, not provider fields', async () => {
    const execute = vi.fn(async (_input: { value: string }, context: ToolExecutionContext) => ({
      ok: true,
      value: `${context.taskId}|${context.workspace.id}|${context.environment}|${context.permissionMode}`
    }))
    const { runtime } = createRuntime(execute)
    const task = createAndStart(runtime)
    const result = await runtime.submitNativeToolCall(task.id, {
      ...nativeCall(),
      taskId: 'attacker-task',
      workspaceId: 'attacker-workspace',
      environment: 'local',
      permissionMode: 'read-only'
    })

    expect(result).toEqual({ ok: true, value: 'task-1|workspace-1|docker|ask-every-time' })
    expect(execute).toHaveBeenCalledTimes(1)
    runtime.completeTask(task.id)
  })

  it('rejects invalid trusted task contexts and out-of-range timeouts at runtime', () => {
    const { runtime } = createRuntime()
    const valid = {
      sessionId: 'session-1', workspace, ownerWebContentsId: 101,
      permissionMode: 'ask-every-time', environment: 'docker'
    } satisfies CreateTaskInput
    const invalidInputs: CreateTaskInput[] = [
      { ...valid, permissionMode: 'invalid' as CreateTaskInput['permissionMode'] },
      { ...valid, environment: 'host' as CreateTaskInput['environment'] },
      { ...valid, workspace: { ...workspace, rootPath: '   ' } },
      { ...valid, workspace: { ...workspace, realRootPath: '' } },
      { ...valid, workspace: { ...workspace, createdAt: Number.NaN } },
      { ...valid, workspace: { ...workspace, createdAt: 1.5 } },
      { ...valid, taskTimeoutMs: MAX_TIMEOUT_MS + 1 },
      { ...valid, toolTimeoutMs: MAX_TIMEOUT_MS + 1 }
    ]

    for (const input of invalidInputs) {
      expectRuntimeError(() => runtime.createTask(input), 'INVALID_TASK_INPUT')
    }
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('rejects malformed, duplicate and unknown calls before execution', async () => {
    const { runtime, execute } = createRuntime()
    const task = createAndStart(runtime)
    const malformed = await runtime.submitNativeToolCall(task.id, '```json {} ```')
    expect(malformed.ok).toBe(false)
    expect(execute).not.toHaveBeenCalled()
    expect(runtime.activeTaskCount).toBe(0)

    const second = createAndStart(runtime, { sessionId: 'session-2' })
    await expect(runtime.submitNativeToolCall(second.id, nativeCall('call-1', 'test.unknown'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_TOOL' }
    })
    expect(runtime.activeTaskCount).toBe(0)

    const third = createAndStart(runtime, { sessionId: 'session-3' })
    const firstResult = await runtime.submitNativeToolCall(third.id, nativeCall('call-1'))
    expect(firstResult.ok).toBe(true)
    await expect(runtime.submitNativeToolCall(third.id, nativeCall('call-1'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_CALL_ID' }
    })
  })

  it('runs calls strictly in submission order without overlap', async () => {
    let resolveFirst: ((result: ToolResult<unknown>) => void) | undefined
    const execute = vi.fn((_input: { value: string }) => new Promise<ToolResult<unknown>>((resolve) => {
      resolveFirst = resolve
    }))
    const { runtime } = createRuntime(execute)
    const task = createAndStart(runtime)
    const first = runtime.submitNativeToolCall(task.id, nativeCall('call-1'))
    const second = runtime.submitNativeToolCall(task.id, nativeCall('call-2'))
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)

    const firstResolution = resolveFirst
    expect(firstResolution).toBeTypeOf('function')
    firstResolution?.({ ok: true, value: 'first' })
    await expect(first).resolves.toEqual({ ok: true, value: 'first' })
    await flush()
    expect(execute).toHaveBeenCalledTimes(2)
    runtime.cancelTask(task.id)
    await expect(second).resolves.toMatchObject({ ok: false, error: { code: 'TASK_CANCELLED' } })
  })

  it('fails the task and prevents queued calls when a tool returns an error', async () => {
    const execute = vi.fn(async () => ({ ok: false, error: { code: 'DENIED', message: 'No' } }))
    const { runtime } = createRuntime(execute)
    const task = createAndStart(runtime)
    const first = runtime.submitNativeToolCall(task.id, nativeCall('call-1'))
    const second = runtime.submitNativeToolCall(task.id, nativeCall('call-2'))

    await expect(first).resolves.toMatchObject({ ok: false, error: { code: 'DENIED' } })
    await expect(second).resolves.toMatchObject({ ok: false, error: { code: 'TASK_CANCELLED' } })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('normalizes malformed tool results and closes both current and queued calls', async () => {
    const execute = vi.fn(async () => undefined as unknown as ToolResult<unknown>)
    const { runtime } = createRuntime(execute)
    const task = createAndStart(runtime)
    const first = runtime.submitNativeToolCall(task.id, nativeCall('call-1'))
    const second = runtime.submitNativeToolCall(task.id, nativeCall('call-2'))

    await expect(first).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_TOOL_RESULT' } })
    await expect(second).resolves.toMatchObject({ ok: false, error: { code: 'TASK_CANCELLED' } })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(runtime.activeTaskCount).toBe(0)
  })

  it.each([null, { ok: 'yes' }, { ok: false, error: { code: 1, message: 'bad' } }])(
    'rejects malformed tool result %j',
    async (invalidResult) => {
      const { runtime } = createRuntime(async () => invalidResult as unknown as ToolResult<unknown>)
      const task = createAndStart(runtime)
      await expect(runtime.submitNativeToolCall(task.id, nativeCall())).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_TOOL_RESULT' }
      })
      expect(runtime.activeTaskCount).toBe(0)
    }
  )

  it('rejects unsafe successful tool values before they can return to a model', async () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    const { runtime } = createRuntime(async () => ({ ok: true, value: cyclic }))
    const task = createAndStart(runtime)
    await expect(runtime.submitNativeToolCall(task.id, nativeCall())).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_TOOL_RESULT' }
    })
    expect(runtime.activeTaskCount).toBe(0)
  })

  it.each([
    { ok: true, value: Number.POSITIVE_INFINITY },
    { ok: true, value: { ["x".repeat(100_001)]: true } },
    { ok: false, error: { code: 'x'.repeat(129), message: 'bad' } },
    { ok: false, error: { code: 'FAIL', message: 'x'.repeat(100_001) } }
  ])('rejects unsafe tool output envelope %#', async (unsafeResult) => {
    const { runtime } = createRuntime(async () => unsafeResult as ToolResult<unknown>)
    const task = createAndStart(runtime)
    await expect(runtime.submitNativeToolCall(task.id, nativeCall())).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_TOOL_RESULT' }
    })
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('aborts timed out tools, normalizes the error and fails once', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const execute = vi.fn(async (_input: { value: string }, context: ToolExecutionContext) => {
      signal = context.signal
      return new Promise<ToolResult<unknown>>(() => undefined)
    })
    const { runtime } = createRuntime(execute, { defaultToolTimeoutMs: 50 })
    const events: Array<{ type: string; payload: unknown }> = []
    runtime.subscribe((event) => events.push(event))
    const task = createAndStart(runtime)
    const result = runtime.submitNativeToolCall(task.id, nativeCall())
    await flush()
    await vi.advanceTimersByTimeAsync(50)

    await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'TOOL_TIMEOUT' } })
    expect(signal?.aborted).toBe(true)
    expect(events.filter((event) => event.type === 'task.status-changed')).toHaveLength(2)
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('uses a single cancelled terminal state for the task timeout', async () => {
    vi.useFakeTimers()
    const { runtime } = createRuntime(undefined, { defaultTaskTimeoutMs: 50 })
    const events: Array<{ type: string; payload: { to?: string; reason?: string } }> = []
    runtime.subscribe((event) => events.push(event as typeof events[number]))
    createAndStart(runtime)
    await vi.advanceTimersByTimeAsync(50)

    const changes = events.filter((event) => event.type === 'task.status-changed')
    expect(changes.map((event) => event.payload.to)).toEqual(['running', 'stopping', 'cancelled'])
    expect(changes.at(-1)?.payload.reason).toBe('task_timeout')
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('cancels a running tool when the task timeout wins', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const execute = vi.fn(async (_input: { value: string }, context: ToolExecutionContext) => {
      signal = context.signal
      return new Promise<ToolResult<unknown>>(() => undefined)
    })
    const { runtime } = createRuntime(execute, {
      defaultTaskTimeoutMs: 50,
      defaultToolTimeoutMs: 100
    })
    const task = createAndStart(runtime)
    const pending = runtime.submitNativeToolCall(task.id, nativeCall())
    await flush()
    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'TASK_CANCELLED' } })
    expect(signal?.aborted).toBe(true)
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('cleans task abort listeners after consecutive successful calls', async () => {
    const added = vi.spyOn(AbortSignal.prototype, 'addEventListener')
    const removed = vi.spyOn(AbortSignal.prototype, 'removeEventListener')
    const { runtime } = createRuntime()
    const task = createAndStart(runtime)

    await runtime.submitNativeToolCall(task.id, nativeCall('call-1'))
    await runtime.submitNativeToolCall(task.id, nativeCall('call-2'))

    const abortAdds = added.mock.calls.filter(([type]) => type === 'abort').length
    const abortRemoves = removed.mock.calls.filter(([type]) => type === 'abort').length
    expect(abortAdds).toBe(4)
    expect(abortRemoves).toBe(4)
    runtime.completeTask(task.id)
  })

  it('clears the task timeout when a task reaches a terminal state', () => {
    vi.useFakeTimers()
    const { runtime } = createRuntime()
    const task = createAndStart(runtime)
    expect(vi.getTimerCount()).toBe(1)
    runtime.completeTask(task.id)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels tasks by session, workspace, owner and globally', () => {
    const { runtime } = createRuntime()
    const sessionTask = createAndStart(runtime, { sessionId: 'session-1' })
    const workspaceTask = createAndStart(runtime, { sessionId: 'session-2', workspace: { ...workspace, id: 'workspace-2' } })
    const ownerTask = createAndStart(runtime, { sessionId: 'session-3', ownerWebContentsId: 202 })
    const globalTask = createAndStart(runtime, { sessionId: 'session-4', ownerWebContentsId: 303 })

    expect(runtime.cancelSession('session-1')).toBe(1)
    expect(runtime.cancelWorkspace('workspace-2')).toBe(1)
    expect(runtime.cancelOwner(202)).toBe(1)
    expect(runtime.getTaskSnapshot(sessionTask.id)).toBeUndefined()
    expect(runtime.getTaskSnapshot(workspaceTask.id)).toBeUndefined()
    expect(runtime.getTaskSnapshot(ownerTask.id)).toBeUndefined()
    expect(runtime.cancelAll()).toBe(1)
    expect(runtime.getTaskSnapshot(globalTask.id)).toBeUndefined()
  })

  it('cleans workspace and owner indexes after completion, failure and cancellation', async () => {
    const completed = createRuntime()
    const completedTask = createAndStart(completed.runtime)
    completed.runtime.completeTask(completedTask.id)
    expect(completed.runtime.cancelWorkspace('workspace-1')).toBe(0)
    expect(completed.runtime.cancelOwner(101)).toBe(0)

    const failed = createRuntime(async () => ({ ok: false, error: { code: 'FAIL', message: 'fail' } }))
    const failedTask = createAndStart(failed.runtime)
    await failed.runtime.submitNativeToolCall(failedTask.id, nativeCall())
    expect(failed.runtime.cancelWorkspace('workspace-1')).toBe(0)
    expect(failed.runtime.cancelOwner(101)).toBe(0)

    const cancelled = createRuntime()
    const cancelledTask = createAndStart(cancelled.runtime)
    cancelled.runtime.cancelTask(cancelledTask.id)
    expect(cancelled.runtime.cancelWorkspace('workspace-1')).toBe(0)
    expect(cancelled.runtime.cancelOwner(101)).toBe(0)
  })

  it('cancels queued calls without starting them', async () => {
    let resolveTool: ((result: ToolResult<unknown>) => void) | undefined
    const execute = vi.fn(() => new Promise<ToolResult<unknown>>((resolve) => { resolveTool = resolve }))
    const { runtime } = createRuntime(execute)
    const task = createAndStart(runtime)
    const first = runtime.submitNativeToolCall(task.id, nativeCall('call-1'))
    const second = runtime.submitNativeToolCall(task.id, nativeCall('call-2'))
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)

    runtime.cancelTask(task.id)
    resolveTool?.({ ok: true, value: 'late' })
    await expect(first).resolves.toMatchObject({ ok: false, error: { code: 'TASK_CANCELLED' } })
    await expect(second).resolves.toMatchObject({ ok: false, error: { code: 'TASK_CANCELLED' } })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('suppresses a late successful result after cancellation', async () => {
    let resolveTool: ((result: ToolResult<unknown>) => void) | undefined
    const execute = vi.fn(() => new Promise<ToolResult<unknown>>((resolve) => { resolveTool = resolve }))
    const { runtime } = createRuntime(execute)
    const events: Array<{ type: string; payload: unknown }> = []
    runtime.subscribe((event) => events.push(event))
    const task = createAndStart(runtime)
    const pending = runtime.submitNativeToolCall(task.id, nativeCall())
    await flush()
    runtime.cancelTask(task.id, 'user')
    resolveTool?.({ ok: true, value: 'late' })
    await flush()

    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'TASK_CANCELLED' } })
    expect(events.filter((event) => event.type === 'tool.completed')).toHaveLength(0)
    expect(events.filter((event) => event.type === 'task.status-changed').map((event) =>
      (event.payload as { to: string }).to
    )).toEqual(['running', 'stopping', 'cancelled'])
  })

  it('contains listener exceptions so later listeners and task execution still work', async () => {
    const { runtime } = createRuntime()
    const observed: string[] = []
    let completedPayload: unknown
    runtime.subscribe(() => { throw new Error('observer error') })
    runtime.subscribe((event) => {
      observed.push(event.type)
      if (event.type === 'tool.completed') completedPayload = event.payload
    })
    const task = createAndStart(runtime)
    await expect(runtime.submitNativeToolCall(task.id, nativeCall())).resolves.toEqual({ ok: true, value: 'ok' })

    expect(observed).toEqual(['task.created', 'task.status-changed', 'tool.requested', 'tool.completed'])
    expect(completedPayload).toEqual({ callId: 'call-1', toolName: 'test.echo', ok: true })
    expect(runtime.completeTask(task.id)).toBe(true)
  })

  it('batches streamed output, chunks it, and keeps event sequences monotonic', async () => {
    vi.useFakeTimers()
    const { runtime } = createRuntime(undefined, {
      outputFlushMs: 50,
      outputChunkBytes: 4,
      outputPendingBytes: 32,
      outputTotalBytes: 32
    })
    const events: Array<{ type: string; sequence: number; payload: unknown }> = []
    runtime.subscribe((event) => events.push(event))
    const task = createAndStart(runtime)
    runtime.appendOutput(task.id, 'model', 'ab')
    runtime.appendOutput(task.id, 'model', 'cdef')
    expect(events.filter((event) => event.type === 'task.output')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(50)
    const output = events.filter((event) => event.type === 'task.output')
    expect(output.map((event) => event.payload)).toEqual([
      { stream: 'model', chunk: 'abcd' },
      { stream: 'model', chunk: 'ef' }
    ])
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4])
    runtime.completeTask(task.id)
  })

  it('applies pending backpressure and force-flushes output before terminal status', () => {
    vi.useFakeTimers()
    const { runtime } = createRuntime(undefined, {
      outputFlushMs: 100,
      outputChunkBytes: 8,
      outputPendingBytes: 5,
      outputTotalBytes: 8
    })
    const events: Array<{ type: string; payload: unknown }> = []
    runtime.subscribe((event) => events.push(event))
    const task = createAndStart(runtime)
    runtime.appendOutput(task.id, 'stdout', 'abcdefgh')
    runtime.completeTask(task.id)

    expect(events.map((event) => event.type)).toEqual([
      'task.created',
      'task.status-changed',
      'task.output',
      'task.notice',
      'task.status-changed'
    ])
    expect(events[2].payload).toEqual({ stream: 'stdout', chunk: 'abcde' })
    expect(events[3].payload).toMatchObject({ code: 'OUTPUT_TRUNCATED' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
