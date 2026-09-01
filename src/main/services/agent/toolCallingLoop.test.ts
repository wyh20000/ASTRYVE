import { describe, expect, it, vi } from 'vitest'
import type { ChatCompletionTurn, ChatMessage } from '../modelProvider'
import type { ToolDefinition } from '../../../shared/agent'
import { TaskRuntime } from './taskRuntime'
import { ToolRegistry } from './toolRegistry'
import { runToolCallingLoop } from './toolCallingLoop'

const workspace = {
  id: 'workspace-1',
  rootPath: 'D:\\repo',
  realRootPath: 'D:\\repo',
  createdAt: 1
}

function echoTool(): ToolDefinition<{ value: string }, string> {
  return {
    name: 'test.echo',
    operation: 'fs.read',
    description: 'Echo a test value',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false
    },
    validateArgs: (input): input is { value: string } =>
      !!input && typeof input === 'object' && typeof (input as { value?: unknown }).value === 'string',
    execute: async (input) => ({ ok: true, value: input.value })
  }
}

function setup() {
  const registry = new ToolRegistry()
  registry.register(echoTool())
  const runtime = new TaskRuntime(registry, { createTaskId: () => 'task-1' })
  const task = runtime.createTask({
    sessionId: 'session-1',
    workspace,
    ownerWebContentsId: 1,
    permissionMode: 'ask-every-time',
    environment: 'docker'
  })
  return { registry, runtime, task }
}

function toolTurn(id = 'call-1'): ChatCompletionTurn {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id,
        type: 'function',
        function: { name: 'test.echo', arguments: '{"value":"hello"}' }
      }]
    },
    finishReason: 'tool_calls'
  }
}

function finalTurn(): ChatCompletionTurn {
  return {
    message: { role: 'assistant', content: 'done' },
    finishReason: 'stop'
  }
}

describe('runToolCallingLoop', () => {
  it('sends closed schemas, executes native calls, and returns tool results to the next round', async () => {
    const { registry, runtime, task } = setup()
    const seenMessages: ChatMessage[][] = []
    const seenSignals: AbortSignal[] = []
    const runRound = vi.fn(async (model, messages, onEvent, options) => {
      seenMessages.push([...messages])
      if (model.signal) seenSignals.push(model.signal)
      await onEvent({ content: seenMessages.length === 1 ? '' : 'done' })
      expect(options.tools[0].function.parameters.additionalProperties).toBe(false)
      return seenMessages.length === 1 ? toolTurn() : finalTurn()
    })
    const events: Array<{ done?: boolean }> = []

    const result = await runToolCallingLoop({
      taskRuntime: runtime,
      registry,
      taskId: task.id,
      model: { baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model' },
      messages: [{ role: 'user', content: 'echo' }],
      onEvent: (event) => {
        events.push(event)
      },
      runRound
    })

    expect(result.status).toBe('completed')
    expect(result.rounds).toBe(2)
    expect(seenMessages[1].at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      name: 'test.echo',
      content: '{"ok":true,"value":"hello"}'
    })
    expect(seenSignals[0]).toBe(seenSignals[1])
    expect(events.filter((event) => event.done)).toHaveLength(1)
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('rejects builtin calls through TaskRuntime and does not start another round', async () => {
    const { registry, runtime, task } = setup()
    const runRound = vi.fn(async () => ({
      message: {
        role: 'assistant' as const,
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'builtin_function' as const,
          function: { name: '$web_search', arguments: '{}' }
        }]
      },
      finishReason: 'tool_calls'
    }))
    const result = await runToolCallingLoop({
      taskRuntime: runtime,
      registry,
      taskId: task.id,
      model: { baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model' },
      messages: [],
      onEvent: () => undefined,
      runRound
    })
    expect(result).toMatchObject({ status: 'failed', error: { code: 'INVALID_ENVELOPE' } })
    expect(runRound).toHaveBeenCalledTimes(1)
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('fails and aborts the task when the model round throws', async () => {
    const { registry, runtime, task } = setup()
    let signal: AbortSignal | undefined
    await expect(runToolCallingLoop({
      taskRuntime: runtime,
      registry,
      taskId: task.id,
      model: { baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model' },
      messages: [],
      onEvent: () => undefined,
      runRound: async (model) => {
        signal = model.signal
        throw new Error('provider failed')
      }
    })).rejects.toThrow('provider failed')
    expect(signal?.aborted).toBe(true)
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('propagates session cancellation into an active model request', async () => {
    const { registry, runtime, task } = setup()
    let started: (() => void) | undefined
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const loop = runToolCallingLoop({
      taskRuntime: runtime,
      registry,
      taskId: task.id,
      model: { baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model' },
      messages: [],
      onEvent: () => undefined,
      runRound: async (model) => new Promise((_resolve, reject) => {
        model.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        started?.()
      })
    })
    await ready
    expect(runtime.cancelSession('session-1', 'session_deleted')).toBe(1)
    await expect(loop).rejects.toThrow('aborted')
    expect(runtime.activeTaskCount).toBe(0)
  })

  it('stops deterministic repeated tool calls at the configured round limit', async () => {
    const { registry, runtime, task } = setup()
    let call = 0
    const result = await runToolCallingLoop({
      taskRuntime: runtime,
      registry,
      taskId: task.id,
      model: { baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'model' },
      messages: [],
      onEvent: () => undefined,
      maxToolRounds: 2,
      runRound: async () => toolTurn(`call-${++call}`)
    })
    expect(result).toMatchObject({ status: 'failed', error: { code: 'TOOL_ROUND_LIMIT' } })
    expect(runtime.activeTaskCount).toBe(0)
  })
})
