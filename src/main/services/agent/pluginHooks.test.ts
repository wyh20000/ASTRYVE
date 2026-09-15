import { describe, expect, it, vi } from 'vitest'
import type { TaskEvent } from '../../../shared/agent'
import { PluginHookController } from './pluginHooks'

function event(type: TaskEvent['type'], payload: unknown = {}): TaskEvent {
  return { taskId: 'task-1', sessionId: 'session-1', sequence: 1, type, timestamp: 10, payload }
}

describe('PluginHookController', () => {
  it('runs allowlisted hooks by priority with a sanitized read-only event', async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const worker = {
      invoke: async (name: string, args: unknown) => { calls.push({ name, args }); return { registerTool: 'escape' } }
    }
    const controller = new PluginHookController([
      { pluginId: 'low.plugin', version: '1.0.0', event: 'tool.completed', name: 'hook_0', priority: 0, timeoutMs: 1000, worker },
      { pluginId: 'high.plugin', version: '2.0.0', event: 'tool.completed', name: 'hook_0', priority: 50, timeoutMs: 1000, worker }
    ])

    controller.observe(event('tool.completed', {
      callId: 'call-1234567890abcdef', toolName: 'workspace.readFile', ok: true,
      args: { secret: 'must-not-cross-boundary' }, result: 'must-not-cross-boundary'
    }))
    await controller.drain()

    expect(calls.map((item) => item.name)).toEqual(['hook_0', 'hook_0'])
    expect(calls[0].args).toEqual({
      type: 'tool.completed', timestamp: 10,
      payload: { callId: 'call-1234567890abcdef', toolName: 'workspace.readFile', ok: true }
    })
    expect(JSON.stringify(calls)).not.toContain('must-not-cross-boundary')
  })

  it('isolates failures and timeouts so later hooks and the task continue', async () => {
    vi.useFakeTimers()
    const completed: string[] = []
    const failed = vi.fn()
    const controller = new PluginHookController([
      { pluginId: 'slow.plugin', event: 'task.created', name: 'hook_0', priority: 10, timeoutMs: 50,
        worker: { invoke: async () => new Promise(() => undefined) } },
      { pluginId: 'healthy.plugin', event: 'task.created', name: 'hook_0', priority: 0, timeoutMs: 1000,
        worker: { invoke: async () => { completed.push('healthy') } } }
    ], { failed })

    controller.observe(event('task.created', {
      id: 'task-1', workspaceId: 'workspace-1', rootPath: 'D:\\private'
    }))
    await vi.advanceTimersByTimeAsync(50)
    await controller.drain()
    vi.useRealTimers()

    expect(completed).toEqual(['healthy'])
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'slow.plugin', reasonCode: 'PLUGIN_HOOK_TIMEOUT', taskId: 'task-1', workspaceId: 'workspace-1'
    }))
  })

  it('ignores non-allowlisted high-volume or approval events', async () => {
    const invoke = vi.fn()
    const controller = new PluginHookController([
      { pluginId: 'one.plugin', event: 'task.created', name: 'hook_0', priority: 0, timeoutMs: 1000,
        worker: { invoke } }
    ])
    controller.observe(event('task.output', { stream: 'model', chunk: 'private output' }))
    controller.observe(event('approval.required', { details: 'private approval' }))
    await controller.drain()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not clear a plugin failure when another hook from that plugin succeeds', async () => {
    const succeeded = vi.fn()
    const failed = vi.fn()
    const controller = new PluginHookController([
      { pluginId: 'mixed.plugin', event: 'task.created', name: 'hook_0', priority: 10, timeoutMs: 1000,
        worker: { invoke: async () => { throw new Error('broken') } } },
      { pluginId: 'mixed.plugin', event: 'task.created', name: 'hook_1', priority: 0, timeoutMs: 1000,
        worker: { invoke: async () => undefined } }
    ], { succeeded, failed })
    controller.observe(event('task.created', { workspaceId: 'workspace-1' }))
    await controller.drain()
    expect(failed).toHaveBeenCalledOnce()
    expect(succeeded).not.toHaveBeenCalled()
  })
})
