import { useEffect, useMemo, useState } from 'react'
import type { ApprovalScope } from '@shared/agent'
import type { ApprovalUiRequest } from '@shared/types'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { Button } from '../ui'
import { Icon } from '../ui/icons'

export default function ApprovalDialog(): JSX.Element | null {
  const requests = useChatStore((state) => state.approvalRequests)
  const clear = useChatStore((state) => state.clearApprovalRequest)
  const sessions = useSessionStore((state) => state.sessions)
  const activeId = useSessionStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const pending = Object.values(requests).filter((item): item is ApprovalUiRequest => Boolean(item))
    const nextExpiry = pending.reduce((earliest, item) => Math.min(earliest, item.expiresAt), Number.POSITIVE_INFINITY)
    if (!Number.isFinite(nextExpiry)) return
    const timer = window.setTimeout(() => {
      for (const item of pending) if (item.expiresAt <= Date.now()) clear(item.sessionId, item.id)
      setNow(Date.now())
    }, Math.max(0, nextExpiry - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [requests, clear, now])
  const request = useMemo(() => Object.values(requests)
    .filter((item) => item && item.expiresAt > Math.max(now, Date.now()))
    .sort((left, right) => (right?.expiresAt ?? 0) - (left?.expiresAt ?? 0))[0], [requests, now])
  if (!request) return null
  const sessionName = sessions.find((session) => session.id === request.sessionId)?.title || '新对话'
  return <ApprovalDialogView request={request} sessionName={sessionName} background={activeId !== request.sessionId}
    onClear={() => clear(request.sessionId, request.id)} />
}

export function ApprovalDialogView({ request, onClear, sessionName, background = false }: {
  request: ApprovalUiRequest
  onClear: () => void
  sessionName?: string
  background?: boolean
}): JSX.Element {
  const [submitting, setSubmitting] = useState<ApprovalScope | 'deny'>()
  const [error, setError] = useState('')

  useEffect(() => { setSubmitting(undefined); setError('') }, [request?.id])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void respond(undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request?.id])

  const respond = async (scope?: ApprovalScope): Promise<void> => {
    if (submitting) return
    setSubmitting(scope ?? 'deny'); setError('')
    const result = await window.agent.approval.respond({ requestId: request.id, scope })
    if (result.ok) onClear()
    else { setSubmitting(undefined); setError(result.error.message) }
  }
  const riskTone = riskClass(request.risk)

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 py-10 backdrop-blur-[2px]"
    role="dialog" aria-modal="true" aria-labelledby="approval-title">
    <section className="flex max-h-[min(620px,calc(100vh-80px))] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border-strong bg-bg-panel shadow-2xl">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3.5">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${riskTone.icon}`}>
          <Icon.Shield size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 id="approval-title" className="truncate text-[14px] font-semibold text-txt-primary">{request.title}</h2>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[14px] ${riskTone.badge}`}>{request.risk}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-[14px] leading-4 text-txt-muted">{request.summary}</p>
          {sessionName && <p className="mt-1 text-[14px] text-txt-secondary">来自会话：{sessionName}{background ? '（后台）' : ''}</p>}
        </div>
      </header>

      <div className="min-h-0 overflow-y-auto px-4 py-3">
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[14px]">
          <span className="text-txt-muted">项目</span><span className="text-txt-secondary">{request.workspace}</span>
          <span className="text-txt-muted">操作</span><span className="text-txt-secondary">{request.operation}</span>
          <span className="text-txt-muted">环境</span><span className="text-txt-secondary">{request.environment}</span>
          <span className="text-txt-muted">目标</span>
          <code className="min-w-0 break-words rounded-md bg-bg-app px-2 py-1.5 font-mono text-[14px] leading-4 text-txt-primary">{request.target}</code>
        </div>
        <details className="group mt-3 rounded-lg border border-border bg-bg-app">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[14px] text-txt-secondary">
            <Icon.ChevronRight size={11} className="transition-transform group-open:rotate-90" />
            查看可信详情与参数摘要
          </summary>
          <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-border px-3 py-2 text-[14px] leading-4">
            <span className="text-txt-muted">工具</span><code className="break-words text-txt-secondary">{request.toolName}</code>
            {request.plugin && <><span className="text-txt-muted">插件</span><code className="break-words text-txt-secondary">{request.plugin.id}{request.plugin.version ? `@${request.plugin.version}` : ''}</code></>}
            <span className="text-txt-muted">调用 ID</span><code className="break-all text-txt-secondary">{request.callId}</code>
            <span className="text-txt-muted">权限依据</span><code className="break-words text-txt-secondary">{request.permissionBasis}</code>
          </div>
          {request.details &&
          <pre className="selectable max-h-44 overflow-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2 font-mono text-[14px] leading-4 text-txt-muted">{request.details}{request.detailsTruncated ? '\n\n[内容过长，界面已截断；审批仍绑定完整参数]' : ''}</pre>
          }
        </details>
        <p className="mt-3 text-[14px] leading-4 text-txt-muted">拒绝后不会执行该操作。批准只对当前显示且经过安全绑定的操作有效。</p>
        {error && <p className="mt-2 text-[14px] text-red-300">{error}</p>}
      </div>

      <footer className="flex flex-wrap justify-end gap-2 border-t border-border bg-bg-raised/50 px-4 py-3">
        {/*
          * 文档 8.7：浮层里的操作统一用全局 Button。
          * 页脚只保留一个主操作（仅批准本次 = primary），其余范围按钮同权重 ——
          * 范围宽度已经由按钮文案说明，不需要再用三种边框/底色去区分。
          */}
        <Button disabled={Boolean(submitting)} onClick={() => void respond()}>
          {submitting === 'deny' ? '拒绝中…' : '拒绝'}
        </Button>
        {request.scopeOptions.includes('task-prefix') && <Button disabled={Boolean(submitting)} onClick={() => void respond('task-prefix')}>
          {submitting === 'task-prefix' ? '批准中…' : '本任务允许相同命令'}
        </Button>}
        {request.scopeOptions.includes('site') && <Button disabled={Boolean(submitting)} onClick={() => void respond('site')}>
          {submitting === 'site' ? '保存中…' : '始终允许读取此网站'}
        </Button>}
        <Button variant="primary" disabled={Boolean(submitting)} onClick={() => void respond('once')}>
          {submitting === 'once' ? '批准中…' : '仅批准本次'}
        </Button>
      </footer>
    </section>
  </div>
}

function riskClass(label: string): { icon: string; badge: string } {
  if (label === '严重风险') return { icon: 'bg-red-500/15 text-red-300', badge: 'bg-red-500/15 text-red-300' }
  if (label === '高风险') return { icon: 'bg-amber-500/15 text-amber-300', badge: 'bg-amber-500/15 text-amber-300' }
  if (label === '中等风险') return { icon: 'bg-orange-500/15 text-orange-300', badge: 'bg-orange-500/15 text-orange-300' }
  return { icon: 'bg-accent-dim/25 text-accent', badge: 'bg-accent-dim/25 text-accent' }
}
