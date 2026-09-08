import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest, TaskSnapshot } from '../../../shared/agent'
const mocks = vi.hoisted(() => ({ windows: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: mocks.windows } }))
import { createApprovalDialog, submitApprovalDecision, toApprovalView } from './approvalDialog'

describe('application approval dialog ownership', () => {
  const send = vi.fn()
  const owner = { webContents: { id: 5, send }, isDestroyed: () => false }
  const request = { id: 'approval-1', taskId: 'task', workspaceId: 'workspace', operation: 'process.run',
    environment: 'local', risk: 'medium', summary: '运行项目测试（COMMAND_REQUIRES_APPROVAL）',
    normalizedTarget: JSON.stringify({ type: 'command', command: { executable: 'npm', args: ['test'] } }),
    scopeOptions: ['once', 'task-prefix'], expiresAt: Date.now() + 60_000 } as ApprovalRequest
  const task = { id: 'task', sessionId: 'session-1', workspaceId: 'workspace', ownerWebContentsId: 5 } as TaskSnapshot

  beforeEach(() => { vi.resetAllMocks(); mocks.windows.mockReturnValue([owner]) })

  it('sends a compact request to the owning renderer and accepts only an allowed scope', async () => {
    const pending = createApprovalDialog(() => task)(request, new AbortController().signal)
    expect(send).toHaveBeenCalledWith('approval:requested', expect.objectContaining({
      id: 'approval-1', sessionId: 'session-1', title: '确认运行命令', target: 'npm test'
    }))
    expect(submitApprovalDecision({ requestId: 'approval-1', scope: 'task-prefix' }, 5)).toBe(true)
    await expect(pending).resolves.toBe('task-prefix')
    expect(send).toHaveBeenLastCalledWith('approval:resolved', { id: 'approval-1', sessionId: 'session-1' })
  })

  it('rejects another renderer, invalid scopes and missing tasks', async () => {
    const pending = createApprovalDialog(() => task)(request, new AbortController().signal)
    expect(submitApprovalDecision({ requestId: 'approval-1', scope: 'once' }, 8)).toBe(false)
    expect(submitApprovalDecision({ requestId: 'approval-1', scope: 'invalid' as never }, 5)).toBe(false)
    expect(submitApprovalDecision({ requestId: 'approval-1' }, 5)).toBe(true)
    await expect(pending).resolves.toBeUndefined()
    expect(await createApprovalDialog(() => undefined)(request, new AbortController().signal)).toBeUndefined()
  })

  it('bounds very long display text without changing the approval request binding', () => {
    const view = toApprovalView({ ...request, summary: `修改文件\n${'x'.repeat(20_000)}` }, task)
    expect(view.summary).toBe('修改文件')
    expect(view.details?.length).toBe(12_000)
    expect(view.detailsTruncated).toBe(true)
    expect(request.normalizedTarget).toContain('npm')
  })
})
