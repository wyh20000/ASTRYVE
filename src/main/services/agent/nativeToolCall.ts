import { MAX_TOOL_ARGUMENT_STRING_LENGTH, hasSafeValueShape, isEntityId, isToolName } from './validation'

/**
 * Provider adapters must pass only an explicitly typed native function call to
 * the runtime. This deliberately does not inspect model text, Markdown, or
 * arbitrary JSON embedded in assistant output.
 */
export interface NativeFunctionToolCall {
  callId: string
  toolName: string
  args: unknown
}

export class NativeToolCallError extends Error {
  constructor(
    readonly code: 'INVALID_ENVELOPE' | 'INVALID_JSON' | 'UNSAFE_ARGUMENTS',
    message: string
  ) {
    super(message)
    this.name = 'NativeToolCallError'
  }
}

/**
 * The intentionally small provider-neutral adapter contract. Providers map
 * their native call representation to this envelope before it reaches the
 * runtime. `arguments` must remain JSON text so parsing happens once here.
 */
export function parseNativeFunctionToolCall(value: unknown): NativeFunctionToolCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NativeToolCallError('INVALID_ENVELOPE', 'Native tool call must be an object')
  }

  const candidate = value as Record<string, unknown>
  if (
    candidate.type !== 'function' ||
    !isEntityId(candidate.id) ||
    !candidate.function ||
    typeof candidate.function !== 'object' ||
    Array.isArray(candidate.function)
  ) {
    throw new NativeToolCallError('INVALID_ENVELOPE', 'Native function call envelope is invalid')
  }

  const functionCall = candidate.function as Record<string, unknown>
  if (!isToolName(functionCall.name) || typeof functionCall.arguments !== 'string') {
    throw new NativeToolCallError('INVALID_ENVELOPE', 'Native function call fields are invalid')
  }
  if (functionCall.arguments.length > MAX_TOOL_ARGUMENT_STRING_LENGTH) {
    throw new NativeToolCallError('UNSAFE_ARGUMENTS', 'Tool arguments exceed the maximum size')
  }

  let args: unknown
  try {
    args = JSON.parse(functionCall.arguments)
  } catch {
    throw new NativeToolCallError('INVALID_JSON', 'Tool arguments are not valid JSON')
  }
  if (!hasSafeValueShape(args)) {
    throw new NativeToolCallError('UNSAFE_ARGUMENTS', 'Tool arguments have an unsafe shape')
  }

  return { callId: candidate.id, toolName: functionCall.name, args }
}
