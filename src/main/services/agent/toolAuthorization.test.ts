import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest, ToolExecutionContext, ToolInvocation, ToolDefinition } from '../../../shared/agent'
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

  it('never offers task-prefix reuse for long-running service starts', async () => {
    let approvalRequest: ApprovalRequest | undefined
    const prompt = vi.fn(async (request: ApprovalRequest) => {
      approvalRequest = request
      return 'once' as const
    })
    const guard = new ToolAuthorization(prompt)
    const context: ToolExecutionContext = {
      taskId: 'task-service', callId: 'call-service',
      workspace: { id: 'workspace-1', rootPath: path.resolve('fixture'), realRootPath: path.resolve('fixture'), createdAt: 1 },
      environment: 'local', permissionMode: 'smart-approval', signal: new AbortController().signal
    }
    const invocation: ToolInvocation = {
      taskId: context.taskId, callId: context.callId, workspaceId: context.workspace.id,
      environment: 'local', permissionMode: 'smart-approval', toolName: 'process.startService',
      args: { executable: 'node', args: ['server.js'], expectedPorts: [3000] }
    }
    const definition: ToolDefinition = {
      name: 'process.startService', operation: 'process.start', description: 'start service',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      validateArgs: (value): value is unknown => Boolean(value), execute: async () => ({ ok: true })
    }
    await expect(guard.authorize(invocation, context, definition)).resolves.toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(approvalRequest?.scopeOptions).toEqual(['once'])
    expect(approvalRequest?.summary).toContain('LONG_RUNNING_COMMAND_REQUIRES_APPROVAL')
  })

  it('binds trusted tool and policy evidence into the approval request', async () => {
    let approvalRequest: ApprovalRequest | undefined
    const fixture = setup(async (request) => {
      approvalRequest = request
      return 'once'
    })

    await fixture.registry.execute(fixture.invocation, fixture.context)

    expect(approvalRequest).toMatchObject({
      toolName: 'workspace.patch',
      callId: 'call-1',
      permissionMode: 'ask-every-time',
      policyReasonCode: 'EXPLICIT_APPROVAL_REQUIRED'
    })
  })

  it.each(['browser.confirmClick', 'browser.history'])(
    'only offers one-shot approval for %s',
    async (toolName) => {
      let approvalRequest: ApprovalRequest | undefined
      const guard = new ToolAuthorization(async (request) => {
        approvalRequest = request
        return 'once'
      })
      const context: ToolExecutionContext = {
        taskId: 'task-browser', callId: `call-${toolName}`,
        workspace: { id: 'workspace-1', rootPath: path.resolve('fixture'), realRootPath: path.resolve('fixture'), createdAt: 1 },
        environment: 'local', permissionMode: 'smart-approval', signal: new AbortController().signal
      }
      const invocation: ToolInvocation = {
        taskId: context.taskId, callId: context.callId, workspaceId: context.workspace.id,
        environment: 'local', permissionMode: 'smart-approval', toolName,
        args: { tabId: 'tab-1', url: 'https://example.com/account' }
      }
      const definition: ToolDefinition = {
        name: toolName, operation: 'browser.interact', description: toolName,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        validateArgs: (value): value is unknown => Boolean(value), execute: async () => ({ ok: true })
      }

      await expect(guard.authorize(invocation, context, definition)).resolves.toBe(true)
      expect(approvalRequest?.scopeOptions).toEqual(['once'])
    }
  )
})
