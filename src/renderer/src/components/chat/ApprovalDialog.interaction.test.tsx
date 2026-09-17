/**
 * @vitest-environment jsdom
 *
 * 阶段 D：审批弹层页脚迁移到全局 `Button` 后的行为回归（文档 8.7）。
 *
 * 审批是安全边界，迁移只能换外观：**点哪个按钮 → 交给 IPC 什么 scope**、
 * 提交期间是否全部禁用、失败后能否重试，都必须逐条证明没变。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalUiRequest } from '@shared/types'
import { ApprovalDialogView } from './ApprovalDialog'

interface RespondInput { requestId: string; scope?: string }
type RespondResult = { ok: true } | { ok: false; error: { message: string } }

const respond = vi.fn(async (_input: RespondInput): Promise<RespondResult> => ({ ok: true }))

function request(overrides: Partial<ApprovalUiRequest> = {}): ApprovalUiRequest {
  return {
    id: 'approval-1', sessionId: 'session-1', title: '确认运行命令', summary: '运行项目测试',
    workspace: 'workspace', environment: 'Docker 沙箱', operation: '运行命令', risk: '中等风险',
    target: 'npm test', details: '{}', scopeOptions: ['once', 'task-prefix', 'site'],
    toolName: 'process.run', callId: 'call-1', permissionBasis: 'ask-every-time · EXPLICIT_APPROVAL_REQUIRED',
    expiresAt: Date.now() + 60_000, ...overrides
  }
}

beforeEach(() => {
  respond.mockReset()
  respond.mockImplementation(async () => ({ ok: true }))
  // setup.ts 只提供了最小 window.agent 桩，这里补上审批通道
  Object.assign(window.agent as unknown as Record<string, unknown>, { approval: { respond } })
})

describe('审批弹层 - 页脚按钮迁移到全局 Button 后行为不变', () => {
  it.each([
    ['仅批准本次', 'once'],
    ['本任务允许相同命令', 'task-prefix'],
    ['始终允许读取此网站', 'site']
  ])('「%s」把 scope=%s 交给 IPC', async (label, scope) => {
    render(<ApprovalDialogView request={request()} onClear={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: label }))

    expect(respond).toHaveBeenCalledTimes(1)
    expect(respond.mock.calls[0][0]).toEqual({ requestId: 'approval-1', scope })
  })

  it('拒绝不携带 scope，IPC 失败时不清理请求（不能假装已处理）', async () => {
    const onClear = vi.fn()
    respond.mockImplementation(async () => ({ ok: false, error: { message: '审批已过期' } }))
    render(<ApprovalDialogView request={request()} onClear={onClear} />)

    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))

    await screen.findByText('审批已过期')
    expect(onClear).not.toHaveBeenCalled()
    expect(respond.mock.calls[0][0].scope).toBeUndefined()
  })

  it('Escape 等价于拒绝（键盘用户不必去点按钮）', async () => {
    const onClear = vi.fn()
    render(<ApprovalDialogView request={request()} onClear={onClear} />)

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(respond).toHaveBeenCalledTimes(1))
    expect(respond.mock.calls[0][0].scope).toBeUndefined()
  })

  it('提交期间四个按钮全部禁用，避免重复审批', async () => {
    const onClear = vi.fn()
    let release: (result: RespondResult) => void = () => undefined
    respond.mockImplementation(() => new Promise<RespondResult>((resolve) => { release = resolve }))
    render(<ApprovalDialogView request={request()} onClear={onClear} />)

    await userEvent.click(screen.getByRole('button', { name: '仅批准本次' }))

    for (const name of ['拒绝', '本任务允许相同命令', '始终允许读取此网站']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }

    release({ ok: true })
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1))
  })

  it('scopeOptions 没有的范围不渲染按钮', () => {
    render(<ApprovalDialogView request={request({ scopeOptions: ['once'] })} onClear={vi.fn()} />)

    expect(screen.getByRole('button', { name: '仅批准本次' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '本任务允许相同命令' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '始终允许读取此网站' })).not.toBeInTheDocument()
  })

  it('IPC 失败时回显错误，按钮恢复可再次操作', async () => {
    respond.mockImplementation(async () => ({ ok: false, error: { message: '审批已过期' } }))
    render(<ApprovalDialogView request={request()} onClear={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '仅批准本次' }))

    expect(await screen.findByText('审批已过期')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '仅批准本次' })).toBeEnabled()
  })
})
