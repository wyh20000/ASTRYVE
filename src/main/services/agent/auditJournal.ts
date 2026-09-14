import fs from 'node:fs'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { AuditEvent } from '../../../shared/agent'

const MAX_EVENTS = 500
const MAX_FILE_BYTES = 1024 * 1024
const OUTCOMES = new Set(['allow', 'ask', 'deny', 'success', 'failure', 'cancelled'])
const APPROVAL_SCOPES = new Set(['once', 'task-prefix', 'site'])
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000

/** Bounded decision journal. Only decision metadata, never prompts/argv/env, reaches disk. */
export class AuditJournal {
  private events: AuditEvent[] = []

  constructor(private readonly filePath: string) {
    fs.mkdirSync(dirname(filePath), { recursive: true })
    if (fs.existsSync(filePath)) {
      const stat = fs.lstatSync(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw new Error('审计日志文件无效')
      const existing: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (!Array.isArray(existing) || existing.length > MAX_EVENTS) throw new Error('审计日志内容无效')
      this.events = existing.map(projectAuditEvent)
    }
  }

  write = (event: AuditEvent): void => {
    const next = [...this.events.slice(-(MAX_EVENTS - 1)), projectAuditEvent(event)]
    const serialized = JSON.stringify(next)
    if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) throw new Error('审计日志超过大小限制')
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const descriptor = fs.openSync(temporary, 'wx', 0o600)
      try {
        fs.writeFileSync(descriptor, serialized, 'utf8')
        fs.fsyncSync(descriptor)
      } finally { fs.closeSync(descriptor) }
      fs.renameSync(temporary, this.filePath)
      this.events = next
    } catch {
      try { fs.rmSync(temporary, { force: true }) } catch { /* best effort */ }
      throw new Error('审计日志写入失败，操作已阻止')
    }
  }

  clear = (): void => {
    try {
      fs.rmSync(this.filePath, { force: true })
      this.events = []
    } catch {
      throw new Error('审计记录清理失败')
    }
  }

  /** Renderer-safe newest-first snapshot. The journal remains the only mutable owner. */
  list = (limit = 100): AuditEvent[] => {
    const bounded = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 0), 100) : 100
    if (bounded === 0) return []
    return structuredClone(this.events.slice(-bounded).reverse())
  }
}

function field(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)) throw new Error('审计字段无效')
  return value
}

function optionalPluginVersion(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9.+_-]{0,63}$/i.test(value)) {
    throw new Error('审计字段无效')
  }
  return value
}

function projectAuditEvent(input: unknown): AuditEvent {
  if (!input || typeof input !== 'object') throw new Error('审计事件无效')
  const event = input as AuditEvent
  if (!OUTCOMES.has(event.outcome) || !['user', 'model', 'policy', 'system'].includes(event.actor) ||
      !Number.isSafeInteger(event.timestamp) || event.timestamp < 0 || event.timestamp > MAX_DATE_TIMESTAMP) {
    throw new Error('审计事件无效')
  }
  const target = typeof event.target === 'string' ? event.target : undefined
  return {
    id: field(event.id), taskId: field(event.taskId), workspaceId: field(event.workspaceId),
    timestamp: event.timestamp, actor: event.actor, action: field(event.action), outcome: event.outcome,
    risk: ['low', 'medium', 'high', 'critical'].includes(event.risk ?? '') ? event.risk : undefined,
    reasonCode: event.reasonCode ? field(event.reasonCode) : undefined,
    target: target ? (/^sha256:[a-f0-9]{64}$/.test(target) ? target : `sha256:${createHash('sha256').update(target).digest('hex')}`) : undefined,
    toolName: event.toolName ? field(event.toolName) : undefined,
    pluginId: event.pluginId ? field(event.pluginId) : undefined,
    pluginVersion: optionalPluginVersion(event.pluginVersion),
    approvalScope: APPROVAL_SCOPES.has(event.approvalScope ?? '') ? event.approvalScope : undefined
    // Deliberately omit arbitrary metadata, even when it was previously sanitized.
  }
}
