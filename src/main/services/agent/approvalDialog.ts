import { BrowserWindow } from 'electron'
import type { ApprovalRequest, ApprovalScope, TaskSnapshot } from '../../../shared/agent'
import type { ApprovalUiRequest, ApprovalUiResponse } from '../../../shared/types'
import { EVENTS } from '../../../shared/ipc'
import type { ApprovalPrompt } from './toolAuthorization'

const MAX_DETAIL_LENGTH = 12_000

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
  const firstLine = cleanText(lines[0] || '此操作需要你的批准', 240)
  const rawDetails = [lines.slice(1).join('\n'), prettyTarget(request.normalizedTarget)].filter(Boolean).join('\n\n')
  const detailsTruncated = rawDetails.length > MAX_DETAIL_LENGTH
  return {
    id: request.id,
    sessionId: task.sessionId,
    title: operationTitle(request.operation),
    summary: firstLine,
    workspace: request.workspaceId,
    environment: request.environment === 'docker' ? 'Docker 沙箱' : '本机执行',
    operation: operationLabel(request.operation),
    risk: riskLabel(request.risk),
    target: targetPreview(request.normalizedTarget),
    details: rawDetails ? rawDetails.slice(0, MAX_DETAIL_LENGTH) : undefined,
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

function targetPreview(target: string): string {
  try {
    const value = JSON.parse(target) as Record<string, unknown>
    if (value.type === 'command' && value.command && typeof value.command === 'object') {
      const command = value.command as { executable?: unknown; args?: unknown }
      const args = Array.isArray(command.args) ? command.args.filter((item): item is string => typeof item === 'string') : []
      return cleanText([command.executable, ...args].filter((item): item is string => typeof item === 'string').join(' '), 320)
    }
    if (value.type === 'host-patch' && Array.isArray(value.paths)) {
      const paths = value.paths.filter((item): item is string => typeof item === 'string')
      return cleanText(paths.slice(0, 3).join('、') + (paths.length > 3 ? ` 等 ${paths.length} 个文件` : ''), 320)
    }
    if (value.type === 'browser' && typeof value.origin === 'string') return cleanText(`${value.action ?? ''} · ${value.origin}`, 320)
    if (typeof value.path === 'string') return cleanText(value.path, 320)
    if (typeof value.host === 'string') return cleanText(value.host, 320)
    if (typeof value.action === 'string') return cleanText(value.action, 320)
  } catch { /* fall through */ }
  return cleanText(target, 320)
}

function prettyTarget(target: string): string {
  try { return JSON.stringify(JSON.parse(target), null, 2) }
  catch { return target }
}

function cleanText(value: string, max: number): string {
  const compact = value.replace(/[\t ]+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}
