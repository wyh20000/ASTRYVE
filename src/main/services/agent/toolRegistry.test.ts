import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition, ToolExecutionContext, ToolInvocation } from '../../../shared/agent'
import { ToolRegistry, ToolRegistryError } from './toolRegistry'
import { hasSafeValueShape, isToolInvocation } from './validation'

interface ReadArgs {
  path: string
}

function readTool(): ToolDefinition<ReadArgs, string> {
  return {
    name: 'workspace.readFile',
    operation: 'fs.read',
    description: 'Read one authorized workspace file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false
    },
    validateArgs: (input): input is ReadArgs =>
      !!input && typeof input === 'object' && typeof (input as { path?: unknown }).path === 'string',
    execute: vi.fn(async () => ({ ok: true, value: 'content' }))
  }
}

function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    taskId: 'task-1',
    callId: 'call-1',
    toolName: 'workspace.readFile',
    args: { path: 'README.md' },
    workspaceId: 'workspace-1',
    environment: 'docker',
    permissionMode: 'ask-every-time',
    ...overrides
  }
}

function expectRegistryError(
  action: () => unknown,
  code: ToolRegistryError['code']
): void {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ToolRegistryError)
  expect((caught as ToolRegistryError).code).toBe(code)
}

describe('ToolRegistry', () => {
  it('registers, validates and executes a declared tool', async () => {
    const registry = new ToolRegistry()
    registry.register(readTool())
    const context = {
      taskId: 'task-1',
      callId: 'call-1',
      workspace: { id: 'workspace-1', rootPath: 'D:\\repo', realRootPath: 'D:\\repo', createdAt: 1 },
      environment: 'docker',
      permissionMode: 'ask-every-time',
      signal: new AbortController().signal
    } satisfies ToolExecutionContext

    await expect(registry.execute(invocation(), context)).resolves.toEqual({
      ok: true,
      value: 'content'
    })
  })

  it('rejects duplicate and unknown tools', () => {
    const registry = new ToolRegistry()
    registry.register(readTool())
    expectRegistryError(() => registry.register(readTool()), 'DUPLICATE_TOOL')
    expectRegistryError(
      () => registry.validate(invocation({ toolName: 'workspace.unknown' })),
      'UNKNOWN_TOOL'
    )
  })

  it('rejects malformed definitions and mismatched trusted context', async () => {
    const registry = new ToolRegistry()
    expectRegistryError(
      () =>
        registry.register({
          ...readTool(),
          name: 'invalid tool name'
        }),
      'INVALID_DEFINITION'
    )
    for (const executionTimeoutMs of [999, 600_001, Number.NaN]) {
      expectRegistryError(
        () => registry.register({ ...readTool(), executionTimeoutMs }),
        'INVALID_DEFINITION'
      )
    }

    registry.register(readTool())
    const context = {
      taskId: 'another-task',
      callId: 'call-1',
      workspace: { id: 'workspace-1', rootPath: 'D:\\repo', realRootPath: 'D:\\repo', createdAt: 1 },
      environment: 'docker',
      permissionMode: 'ask-every-time',
      signal: new AbortController().signal
    } satisfies ToolExecutionContext
    await expect(registry.execute(invocation(), context)).rejects.toMatchObject({
      code: 'CONTEXT_MISMATCH'
    })
  })

  it('rejects invalid arguments and malformed invocations', () => {
    const registry = new ToolRegistry()
    registry.register(readTool())
    expectRegistryError(() => registry.validate(invocation({ args: { path: 42 } })), 'INVALID_ARGS')
    expectRegistryError(() => registry.validate({ taskId: '../escape' }), 'INVALID_INVOCATION')
  })

  it('exports defensive copies of closed native function schemas', () => {
    const registry = new ToolRegistry()
    registry.register(readTool())
    const tools = registry.listNativeFunctionTools()
    expect(tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'workspace.readFile',
          description: 'Read one authorized workspace file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false
          }
        }
      }
    ])
    tools[0].function.parameters.properties.path = { type: 'number' }
    expect(registry.listNativeFunctionTools()[0].function.parameters.properties.path).toEqual({
      type: 'string'
    })
  })

  it('filters provider-visible tools without changing the execution registry', () => {
    const registry = new ToolRegistry()
    registry.register(readTool())
    expect(registry.listNativeFunctionTools(new Set())).toEqual([])
    expect(registry.listNativeFunctionTools(new Set(['workspace.readFile']))).toHaveLength(1)
    expect(registry.validate(invocation()).name).toBe('workspace.readFile')
  })

  it('rejects open or malformed tool schemas', () => {
    const registry = new ToolRegistry()
    expectRegistryError(
      () => registry.register({ ...readTool(), parameters: { ...readTool().parameters, additionalProperties: true as false } }),
      'INVALID_DEFINITION'
    )
  })
})

describe('agent runtime validation', () => {
  it('rejects cyclic and excessively deep tool arguments', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(hasSafeValueShape(cyclic)).toBe(false)

    let deep: Record<string, unknown> = {}
    const root = deep
    for (let index = 0; index < 20; index += 1) {
      deep.next = {}
      deep = deep.next as Record<string, unknown>
    }
    expect(hasSafeValueShape(root)).toBe(false)
  })

  it('accepts only the fixed invocation envelope', () => {
    expect(isToolInvocation(invocation())).toBe(true)
    expect(isToolInvocation(invocation({ environment: 'local' }))).toBe(true)
    expect(isToolInvocation({ ...invocation(), environment: 'host' })).toBe(false)
  })
})
