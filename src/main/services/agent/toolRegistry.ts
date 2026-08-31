import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocation,
  ToolResult
} from '../../../shared/agent'
import { isOperationKind, isToolInvocation, isToolName } from './validation'

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
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>()

  register<TArgs, TResult>(definition: ToolDefinition<TArgs, TResult>): void {
    if (
      !isToolName(definition.name) ||
      !isOperationKind(definition.operation) ||
      typeof definition.description !== 'string' ||
      definition.description.trim().length === 0 ||
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
      invocation.environment !== context.environment
    ) {
      throw new ToolRegistryError(
        'CONTEXT_MISMATCH',
        'Invocation does not match the trusted execution context'
      )
    }
    return this.validate(invocation).execute(invocation.args, context)
  }
}
