import { BrowserWindow } from 'electron'
import type { ApprovalRequest, ApprovalScope, TaskSnapshot } from '../../../shared/agent'
import type { ApprovalUiRequest, ApprovalUiResponse } from '../../../shared/types'
import { EVENTS } from '../../../shared/ipc'
import type { ApprovalPrompt } from './toolAuthorization'

const MAX_DETAIL_LENGTH = 12_000
const MAX_COMMAND_ARGS = 24
const MAX_VALUE_LENGTH = 320
const SENSITIVE_VALUE = /(?:\b(?:basic|bearer)\s+[a-z0-9._~+\/-]+=*|\bsk-[a-z0-9_-]{8,}|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@|\b(?:proxy-)?authorization\b|\b(?:api[-_]?key|cookie|credential|password|secret|token|connection[-_]?string|database[-_]?url)\b\s*[:=])/i
const SENSITIVE_FLAG = /^(?:--?)(?:api[-_]?key|authorization|cookie|credential|password|secret|token)$/i

interface SafeTargetView { preview: string; details: string; truncated: boolean }

interface PendingApproval {
  ownerWebContentsId: number
  request: ApprovalUiRequest
  settle: (scope: ApprovalScope | undefined) => void
}

const pending = new Map<string, PendingApproval>()

/** Keep the binding and final decision in main while presenting a compact application dialog. */
export function createApprovalDialog(getTask: (id: string) => TaskSnapshot | undefined): ApprovalPrompt {
  return async (request, signal) => {
    const task = getTask(request.taskId)
    const owner = task && BrowserWindow.getAllWindows().find((window) => window.webContents.id === task.ownerWebContentsId)
    if (!task || !owner || owner.isDestroyed() || signal.aborted) return undefined
    const view = toApprovalView(request, task)
    return new Promise((resolve) => {
      let settled = false
      const finish = (scope: ApprovalScope | undefined): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        pending.delete(request.id)
        if (!owner.isDestroyed()) owner.webContents.send(EVENTS.approvalResolved, { id: request.id, sessionId: task.sessionId })
        resolve(scope)
      }
      const abort = (): void => finish(undefined)
      pending.set(request.id, { ownerWebContentsId: owner.webContents.id, request: view, settle: finish })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else owner.webContents.send(EVENTS.approvalRequested, view)
    })
  }
}

export function submitApprovalDecision(input: ApprovalUiResponse, senderId: number): boolean {
  if (!input || typeof input !== 'object' || typeof input.requestId !== 'string') return false
  const item = pending.get(input.requestId)
  if (!item || item.ownerWebContentsId !== senderId) return false
  if (input.scope !== undefined && !item.request.scopeOptions.includes(input.scope)) return false
  item.settle(input.scope)
  return true
}

export function toApprovalView(request: ApprovalRequest, task: TaskSnapshot): ApprovalUiRequest {
  const lines = request.summary.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const firstLine = cleanText(sanitizeText(lines[0] || '此操作需要你的批准'), 240)
  const target = safeTargetView(request.normalizedTarget)
  const detailsTruncated = target.truncated || target.details.length > MAX_DETAIL_LENGTH
  return {
    id: request.id,
    sessionId: task.sessionId,
    toolName: request.toolName,
    plugin: request.plugin ? { ...request.plugin } : undefined,
    callId: request.callId,
    permissionBasis: `${request.permissionMode} · ${request.policyReasonCode}`,
    title: operationTitle(request.operation),
    summary: firstLine,
    workspace: request.workspaceId,
    environment: request.environment === 'docker' ? 'Docker 沙箱' : '本机执行',
    operation: operationLabel(request.operation),
    risk: riskLabel(request.risk),
    target: target.preview,
    details: target.details ? target.details.slice(0, MAX_DETAIL_LENGTH) : undefined,
    detailsTruncated: detailsTruncated || undefined,
    scopeOptions: [...request.scopeOptions],
    expiresAt: request.expiresAt
  }
}

function operationTitle(operation: ApprovalRequest['operation']): string {
  if (operation === 'fs.apply-host' || operation === 'fs.patch') return '确认修改项目文件'
  if (operation === 'process.run' || operation === 'process.start') return '确认运行命令'
  if (operation === 'network.enable') return '确认开放网络访问'
  if (operation === 'browser.interact') return '确认操作网页'
  if (operation === 'git.write') return '确认执行 Git 写操作'
  return '确认执行操作'
}

function operationLabel(operation: ApprovalRequest['operation']): string {
  const labels: Partial<Record<ApprovalRequest['operation'], string>> = {
    'fs.patch': '修改文件', 'fs.apply-host': '写入项目', 'process.run': '运行命令',
    'process.start': '启动服务', 'process.stop': '停止服务', 'network.enable': '访问网络',
    'git.write': 'Git 写操作', 'git.read': 'Git 读取', 'fs.read': '读取文件', 'fs.search': '搜索文件',
    'browser.read': '读取网页', 'browser.interact': '操作网页'
  }
  return labels[operation] ?? operation
}

function riskLabel(risk: ApprovalRequest['risk']): ApprovalUiRequest['risk'] {
  return ({ low: '低风险', medium: '中等风险', high: '高风险', critical: '严重风险' } as const)[risk]
}

function safeTargetView(rawTarget: string): SafeTargetView {
  try {
    const target = JSON.parse(rawTarget) as Record<string, unknown>
    if (target.type === 'command' && target.command && typeof target.command === 'object') {
      const command = target.command as Record<string, unknown>
      const executable = safeString(command.executable)
      const args = Array.isArray(command.args) ? safeArguments(command.args) : { values: [], truncated: false }
      const value = { type: 'command', command: { executable: executable.value, args: args.values } }
      return { preview: cleanText([executable.value, ...args.values].filter(Boolean).join(' '), 320), details: JSON.stringify(value, null, 2), truncated: executable.truncated || args.truncated }
    }
    if (target.type === 'host-patch') {
      const pathValues = Array.isArray(target.paths) ? target.paths.slice(0, 20).map(safeString) : []
      const paths = pathValues.map((path) => path.value).filter(Boolean)
      const patchHash = typeof target.patchHash === 'string' && /^[a-f0-9]{64}$/.test(target.patchHash) ? target.patchHash : undefined
      const value = { type: 'host-patch', paths, ...(patchHash ? { patchHash } : {}) }
      return { preview: cleanText(paths.slice(0, 3).join('、') + (paths.length > 3 ? ` 等 ${paths.length} 个文件` : ''), 320), details: JSON.stringify(value, null, 2), truncated: pathValues.some((path) => path.truncated) || (Array.isArray(target.paths) && target.paths.length > 20) }
    }
    if (target.type === 'browser') return targetView('browser', { action: safeString(target.action), origin: safeString(target.origin) }, 'origin')
    if (target.type === 'file') return targetView('file', { path: safeString(target.path) }, 'path')
    if (target.type === 'network') return targetView('network', { protocol: safeString(target.protocol), host: safeString(target.host) }, 'host')
    if (target.type === 'service-stop') return targetView('service-stop', { serviceId: safeString(target.serviceId) }, 'serviceId')
    if (target.type === 'git') return targetView('git', { action: safeString(target.action) }, 'action')
  } catch { /* do not forward malformed target text */ }
  return { preview: '受限目标摘要不可用', details: '', truncated: false }
}

function targetView(type: string, fields: Record<string, SafeText>, previewKey: string): SafeTargetView {
  const values = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.value]))
  return { preview: cleanText(values[previewKey] || type, 320), details: JSON.stringify({ type, ...values }, null, 2), truncated: Object.values(fields).some((field) => field.truncated) }
}

function safeArguments(args: unknown[]): { values: string[]; truncated: boolean } {
  let truncated = args.length > MAX_COMMAND_ARGS
  let unboundedLength = 0
  const values = args.slice(0, MAX_COMMAND_ARGS).map((arg, index) => {
    const previous = args[index - 1]
    if (typeof previous === 'string' && SENSITIVE_FLAG.test(previous)) return '[REDACTED]'
    if (typeof arg !== 'string') return '[REDACTED]'
    if (SENSITIVE_FLAG.test(arg.split('=', 1)[0])) return arg.includes('=') ? `${arg.slice(0, arg.indexOf('=') + 1)}[REDACTED]` : arg
    const value = safeString(arg)
    truncated ||= value.truncated
    unboundedLength += cleanText(sanitizeText(arg), Number.MAX_SAFE_INTEGER).length
    return value.value
  })
  return { values, truncated: truncated || unboundedLength > MAX_DETAIL_LENGTH }
}

interface SafeText { value: string; truncated: boolean }

function safeString(value: unknown): SafeText {
  if (typeof value !== 'string') return { value: '', truncated: false }
  const sanitized = sanitizeText(value)
  const compact = sanitized.replace(/[\t ]+/g, ' ').trim()
  return { value: cleanText(compact, MAX_VALUE_LENGTH), truncated: compact.length > MAX_VALUE_LENGTH }
}

function sanitizeText(value: string): string {
  return SENSITIVE_VALUE.test(value) ? '[REDACTED]' : value
}

function cleanText(value: string, max: number): string {
  const compact = value.replace(/[\t ]+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}
