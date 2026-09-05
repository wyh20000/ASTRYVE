import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext, ToolInvocation, ToolDefinition } from '../../../shared/agent'
import { ToolAuthorization } from './toolAuthorization'
import { ToolRegistry } from './toolRegistry'

function setup(prompt: ConstructorParameters<typeof ToolAuthorization>[0]) {
  const waiting = vi.fn()
  const guard = new ToolAuthorization(prompt, waiting)
  const controller = new AbortController()
  const context: ToolExecutionContext = { taskId: 'task-1', callId: 'call-1',
    workspace: { id: 'workspace-1', rootPath: path.resolve('fixture'), realRootPath: path.resolve('fixture'), createdAt: 1 },
    environment: 'local', permissionMode: 'ask-every-time', signal: controller.signal }
  const invocation: ToolInvocation = { taskId: context.taskId, callId: context.callId, workspaceId: context.workspace.id,
    environment: context.environment, permissionMode: context.permissionMode, toolName: 'workspace.patch', args: { path: 'a.ts' } }
  const execute = vi.fn(async (_input: unknown) => ({ ok: true as const }))
  const definition: ToolDefinition = { name: invocation.toolName, operation: 'fs.patch', description: 'patch',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false },
    validateArgs: (value): value is unknown => !!value, execute }
  const registry = new ToolRegistry((i, c, d) => guard.authorize(i, c, d))
  registry.register(definition)
  return { context, invocation, execute, registry, controller, waiting }
}

describe('tool approval execution gate', () => {
  it('waits for approval before executing and uses the original immutable arguments', async () => {
    let approve!: (value: 'once') => void
    const fixture = setup(() => new Promise((resolve) => { approve = resolve }))
    const result = fixture.registry.execute(fixture.invocation, fixture.context)
    expect(fixture.execute).not.toHaveBeenCalled()
    fixture.invocation.args = { path: 'different.ts' }
    approve('once')
    expect((await result).ok).toBe(true)
    expect(fixture.execute.mock.calls[0][0]).toEqual({ path: 'a.ts' })
    expect(fixture.waiting.mock.calls).toEqual([['task-1', true], ['task-1', false]])
  })

  it('never executes denied operations', async () => {
    const fixture = setup(async () => undefined)
    expect((await fixture.registry.execute(fixture.invocation, fixture.context)).ok).toBe(false)
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('ignores late approval after cancellation even if the UI does not settle', async () => {
    const fixture = setup(() => new Promise(() => undefined))
    const result = fixture.registry.execute(fixture.invocation, fixture.context)
    fixture.controller.abort()
    expect((await result).ok).toBe(false)
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('hard denial bypasses the prompt', async () => {
    const prompt = vi.fn(async () => 'once' as const)
    const fixture = setup(prompt)
    fixture.context.permissionMode = fixture.invocation.permissionMode = 'read-only'
    expect((await fixture.registry.execute(fixture.invocation, fixture.context)).ok).toBe(false)
    expect(prompt).not.toHaveBeenCalled()
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('expires unanswered approvals', async () => {
    vi.useFakeTimers()
    try {
      const fixture = setup(() => new Promise(() => undefined))
      const result = fixture.registry.execute(fixture.invocation, fixture.context)
      await vi.advanceTimersByTimeAsync(120_001)
      expect((await result).ok).toBe(false)
      expect(fixture.execute).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})
