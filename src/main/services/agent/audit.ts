import type { AuditEvent } from '../../../shared/agent'

export const REDACTED = '[REDACTED]'

const SENSITIVE_KEY =
  /(?:api[-_]?key|authorization|cookie|credential|env(?:ironment)?|password|prompt|response|secret|token)/i
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+\/-]+=*|sk-[a-z0-9_-]{8,})/i

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) return '[TRUNCATED]'
  if (typeof value === 'string') return SECRET_VALUE.test(value) ? REDACTED : value
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactValue(child, depth + 1)
    ])
  )
}

/** 审计只记录决策元数据；prompt、回复、凭据与完整环境变量必须脱敏。 */
export function sanitizeAuditEvent(event: AuditEvent): AuditEvent {
  return {
    ...event,
    metadata: event.metadata
      ? (redactValue(event.metadata, 0) as Record<string, unknown>)
      : undefined
  }
}
