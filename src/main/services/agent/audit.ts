import type { AuditEvent } from '../../../shared/agent'

export const REDACTED = '[REDACTED]'
const MAX_AUDIT_STRING = 1_000
const MAX_AUDIT_ARRAY = 50
const MAX_AUDIT_FIELDS = 100

const SENSITIVE_KEY =
  /(?:api[-_]?key|authorization|cookie|credential|env(?:ironment)?|password|prompt|response|secret|token)/i
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+\/-]+=*|sk-[a-z0-9_-]{8,})/i

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) return '[TRUNCATED]'
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) return REDACTED
    const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '')
    return clean.length > MAX_AUDIT_STRING ? `${clean.slice(0, MAX_AUDIT_STRING)}…[TRUNCATED]` : clean
  }
  if (Array.isArray(value)) {
    const result = value.slice(0, MAX_AUDIT_ARRAY).map((item) => redactValue(item, depth + 1))
    if (value.length > MAX_AUDIT_ARRAY) result.push('[TRUNCATED]')
    return result
  }
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).slice(0, MAX_AUDIT_FIELDS).map(([key, child]) => [
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
