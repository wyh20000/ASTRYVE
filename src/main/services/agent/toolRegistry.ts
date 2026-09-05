import type {
  NativeFunctionToolDefinition,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocation,
  ToolResult
} from '../../../shared/agent'
import { hasSafeValueShape, isOperationKind, isToolInvocation, isToolName } from './validation'

export class ToolRegistryError extends Error {
  constructor(
    readonly code:
      | 'INVALID_DEFINITION'
      | 'INVALID_INVOCATION'
      | 'UNKNOWN_TOOL'
      | 'DUPLICATE_TOOL'
      | 'INVALID_ARGS'
      | 'CONTEXT_MISMATCH',
    message: string
  ) {
    super(message)
    this.name = 'ToolRegistryError'
  }
}

export class ToolRegistry {
  constructor(private readonly authorize?: (
    invocation: ToolInvocation, context: ToolExecutionContext, definition: ToolDefinition
  ) => Promise<boolean>) {}
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>()

  register<TArgs, TResult>(definition: ToolDefinition<TArgs, TResult>): void {
    if (
      !isToolName(definition.name) ||
      !isOperationKind(definition.operation) ||
      typeof definition.description !== 'string' ||
      definition.description.trim().length === 0 ||
      !isClosedObjectSchema(definition.parameters) ||
      typeof definition.validateArgs !== 'function' ||
      typeof definition.execute !== 'function'
    ) {
      throw new ToolRegistryError('INVALID_DEFINITION', 'Tool definition contract is invalid')
    }
    if (this.tools.has(definition.name)) {
      throw new ToolRegistryError('DUPLICATE_TOOL', `Tool already registered: ${definition.name}`)
    }
    this.tools.set(definition.name, definition as ToolDefinition<unknown, unknown>)
  }

  list(): Array<Pick<ToolDefinition, 'name' | 'operation' | 'description'>> {
    return [...this.tools.values()].map(({ name, operation, description }) => ({
      name,
      operation,
      description
    }))
  }

  listNativeFunctionTools(): NativeFunctionToolDefinition[] {
    return [...this.tools.values()].map(({ name, description, parameters }) => ({
      type: 'function',
      function: {
        name,
        description,
        parameters: cloneSchema(parameters)
      }
    }))
  }

  validate(invocation: unknown): ToolDefinition<unknown, unknown> {
    if (!isToolInvocation(invocation)) {
      throw new ToolRegistryError('INVALID_INVOCATION', 'Tool invocation contract is invalid')
    }
    const definition = this.tools.get(invocation.toolName)
    if (!definition) {
      throw new ToolRegistryError('UNKNOWN_TOOL', `Unknown tool: ${invocation.toolName}`)
    }
    if (!definition.validateArgs(invocation.args)) {
      throw new ToolRegistryError('INVALID_ARGS', `Invalid arguments for tool: ${invocation.toolName}`)
    }
    return definition
  }

  async execute(
    invocation: ToolInvocation,
    context: ToolExecutionContext
  ): Promise<ToolResult<unknown>> {
    if (
      invocation.taskId !== context.taskId ||
      invocation.callId !== context.callId ||
      invocation.workspaceId !== context.workspace.id ||
      invocation.environment !== context.environment ||
      invocation.permissionMode !== context.permissionMode
    ) {
      throw new ToolRegistryError(
        'CONTEXT_MISMATCH',
        'Invocation does not match the trusted execution context'
      )
    }
    const frozenInvocation = structuredClone(invocation)
    const definition = this.validate(frozenInvocation)
    if (this.authorize && !(await this.authorize(frozenInvocation, context, definition))) {
      return { ok: false, error: { code: 'APPROVAL_DENIED', message: '操作未获批准或等待已取消' } }
    }
    if (context.signal.aborted) {
      return { ok: false, error: { code: 'TASK_CANCELLED', message: '任务已取消' } }
    }
    return definition.execute(frozenInvocation.args, context)
  }
}

function isClosedObjectSchema(value: unknown): value is ToolDefinition['parameters'] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hasSafeValueShape(value)) {
    return false
  }
  const schema = value as Record<string, unknown>
  if (
    schema.type !== 'object' ||
    !schema.properties ||
    typeof schema.properties !== 'object' ||
    Array.isArray(schema.properties) ||
    schema.additionalProperties !== false
  ) {
    return false
  }
  return (
    schema.required === undefined ||
    (Array.isArray(schema.required) && schema.required.every((item) => typeof item === 'string'))
  )
}

function cloneSchema(schema: ToolDefinition['parameters']): ToolDefinition['parameters'] {
  return JSON.parse(JSON.stringify(schema)) as ToolDefinition['parameters']
}
