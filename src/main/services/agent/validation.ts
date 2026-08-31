import {
  EXECUTION_ENVIRONMENTS,
  OPERATION_KINDS,
  type ExecutionEnvironment,
  type OperationKind,
  type ToolInvocation
} from '../../../shared/agent'

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const TOOL_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/

export const MAX_TOOL_ARGUMENT_DEPTH = 12
export const MAX_TOOL_ARGUMENT_NODES = 10_000

function isNonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export function isExecutionEnvironment(value: unknown): value is ExecutionEnvironment {
  return (
    typeof value === 'string' &&
    (EXECUTION_ENVIRONMENTS as readonly string[]).includes(value)
  )
}

export function isOperationKind(value: unknown): value is OperationKind {
  return typeof value === 'string' && (OPERATION_KINDS as readonly string[]).includes(value)
}

export function isToolName(value: unknown): value is string {
  return typeof value === 'string' && TOOL_NAME_PATTERN.test(value)
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
    if (current === null || ['string', 'number', 'boolean'].includes(typeof current)) return true
    if (typeof current !== 'object') return false
    if (seen.has(current)) return false
    seen.add(current)

    const children = Array.isArray(current) ? current : Object.values(current)
    const safe = children.every((child) => visit(child, depth + 1))
    seen.delete(current)
    return safe
  }

  return visit(value, 0)
}

export function isToolInvocation(value: unknown): value is ToolInvocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    isNonEmptyId(candidate.taskId) &&
    isNonEmptyId(candidate.callId) &&
    isToolName(candidate.toolName) &&
    isNonEmptyId(candidate.workspaceId) &&
    isExecutionEnvironment(candidate.environment) &&
    hasSafeValueShape(candidate.args)
  )
}
