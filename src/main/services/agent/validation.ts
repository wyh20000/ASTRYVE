import {
  EXECUTION_ENVIRONMENTS,
  OPERATION_KINDS,
  PERMISSION_MODES,
  type ExecutionEnvironment,
  type OperationKind,
  type PermissionMode,
  type ToolInvocation
} from '../../../shared/agent'

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const TOOL_NAME_PATTERN = /^[a-z][a-zA-Z0-9_-]*(?:\.[a-zA-Z][a-zA-Z0-9_-]*)+$/
const MCP_TOOL_NAME_PATTERN = /^mcp__[a-z0-9][a-z0-9._-]{1,63}__[a-z][a-z0-9._-]{0,63}__[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

export const MAX_TOOL_ARGUMENT_DEPTH = 12
export const MAX_TOOL_ARGUMENT_NODES = 10_000
export const MAX_TOOL_ARGUMENT_STRING_LENGTH = 100_000

export function isEntityId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export function isExecutionEnvironment(value: unknown): value is ExecutionEnvironment {
  return (
    typeof value === 'string' &&
    (EXECUTION_ENVIRONMENTS as readonly string[]).includes(value)
  )
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
}

export function isOperationKind(value: unknown): value is OperationKind {
  return typeof value === 'string' && (OPERATION_KINDS as readonly string[]).includes(value)
}

export function isToolName(value: unknown): value is string {
  return typeof value === 'string' && (TOOL_NAME_PATTERN.test(value) || MCP_TOOL_NAME_PATTERN.test(value))
}

/** 拒绝循环、过深和异常庞大的工具参数，避免在 schema 校验前耗尽主进程。 */
export function hasSafeValueShape(
  value: unknown,
  maxDepth = MAX_TOOL_ARGUMENT_DEPTH,
  maxNodes = MAX_TOOL_ARGUMENT_NODES
): boolean {
  const seen = new Set<object>()
  let nodes = 0

  const visit = (current: unknown, depth: number): boolean => {
    nodes += 1
    if (nodes > maxNodes || depth > maxDepth) return false
    if (typeof current === 'string') return current.length <= MAX_TOOL_ARGUMENT_STRING_LENGTH
    if (typeof current === 'number') return Number.isFinite(current)
    if (current === null || typeof current === 'boolean') return true
    if (typeof current !== 'object') return false
    if (seen.has(current)) return false
    seen.add(current)

    const safe = Array.isArray(current)
      ? current.every((child) => visit(child, depth + 1))
      : Object.entries(current).every(
          ([key, child]) =>
            key.length <= MAX_TOOL_ARGUMENT_STRING_LENGTH && visit(child, depth + 1)
        )
    seen.delete(current)
    return safe
  }

  return visit(value, 0)
}

export function isToolInvocation(value: unknown): value is ToolInvocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    isEntityId(candidate.taskId) &&
    isEntityId(candidate.callId) &&
    isToolName(candidate.toolName) &&
    isEntityId(candidate.workspaceId) &&
    isExecutionEnvironment(candidate.environment) &&
    isPermissionMode(candidate.permissionMode) &&
    hasSafeValueShape(candidate.args)
  )
}
