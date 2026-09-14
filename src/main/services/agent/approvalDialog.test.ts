import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest, TaskSnapshot } from '../../../shared/agent'
const mocks = vi.hoisted(() => ({ windows: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: mocks.windows } }))
import { createApprovalDialog, submitApprovalDecision, toApprovalView } from './approvalDialog'

describe('application approval dialog ownership', () => {
  const send = vi.fn()
  const owner = { webContents: { id: 5, send }, isDestroyed: () => false }
  const request = { id: 'approval-1', taskId: 'task', callId: 'call-approval-1', toolName: 'process.run', workspaceId: 'workspace', operation: 'process.run',
    environment: 'local', risk: 'medium', summary: '运行项目测试（COMMAND_REQUIRES_APPROVAL）',
    permissionMode: 'ask-every-time', policyReasonCode: 'EXPLICIT_APPROVAL_REQUIRED',
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

  it('exposes trusted approval evidence and redacts bounded target parameters', () => {
    const view = toApprovalView({
      ...request,
      toolName: 'process.run',
      permissionMode: 'ask-every-time',
      policyReasonCode: 'EXPLICIT_APPROVAL_REQUIRED',
      normalizedTarget: JSON.stringify({
        type: 'command',
        command: {
          executable: 'npm',
          args: ['publish', '--token', 'super-secret-token'],
          env: { API_KEY: 'secret-key', SAFE: 'visible' }
        }
      })
    }, task)

    expect(view.toolName).toBe('process.run')
    expect(view.callId).toBe(request.callId)
    expect(view.permissionBasis).toContain('ask-every-time')
    expect(view.permissionBasis).toContain('EXPLICIT_APPROVAL_REQUIRED')
    expect(view.details).toContain('[REDACTED]')
    expect(view.details).not.toContain('"env"')
    expect(view.details).not.toContain('super-secret-token')
    expect(view.details).not.toContain('secret-key')
  })

  it('never sends authentication material from command arguments or summaries to the renderer', () => {
    const secrets = [
      'Basic dXNlcjpwYXNz',
      'api_key=plain-api-key',
      'https://alice:plain-password@example.com/private',
      '-----BEGIN PRIVATE KEY-----'
    ]
    const view = toApprovalView({
      ...request,
      summary: `运行脚本 ${secrets[0]}\nAuthorization: ${secrets[0]} ${secrets[1]} ${secrets[2]} ${secrets[3]}`,
      normalizedTarget: JSON.stringify({
        type: 'command',
        command: { executable: 'node', args: ['-e', `fetch("${secrets[2]}", { headers: { Authorization: "${secrets[0]}" }, api_key: "plain-api-key" })`] }
      })
    }, task)

    const rendered = JSON.stringify(view)
    for (const secret of secrets) expect(rendered).not.toContain(secret)
    expect(view.target).toContain('node')
  })

  it('redacts database connection credentials and quoted authorization fields from command arguments', () => {
    const secrets = [
      'postgres://user:postgres-password@db.example/app',
      'postgres://user:p:ass@db.example/app',
      'mysql://user:mysql-password@db.example/app',
      'mongodb://user:mongo-password@db.example/app',
      'redis://user:redis-password@cache.example/0',
      'opaque-auth-value'
    ]
    const view = toApprovalView({
      ...request,
      normalizedTarget: JSON.stringify({
        type: 'command',
        command: { executable: 'node', args: ['-e', JSON.stringify({ Authorization: secrets[4], sources: secrets.slice(0, 4) })] }
      })
    }, task)

    const rendered = JSON.stringify(view)
    for (const secret of secrets) expect(rendered).not.toContain(secret)
    expect(view.target).toContain('node')
  })

  it('redacts command arguments that construct authorization header pairs without colon syntax', () => {
    const secrets = ['opaque-auth-value', 'opaque-proxy']
    const view = toApprovalView({
      ...request,
      normalizedTarget: JSON.stringify({
        type: 'command',
        command: { executable: 'node', args: ['-e', `new Headers([["Authorization", "${secrets[0]}"], ["Proxy-Authorization", "${secrets[1]}"]])`] }
      })
    }, task)

    const rendered = JSON.stringify(view)
    for (const secret of secrets) expect(rendered).not.toContain(secret)
    expect(view.target).toContain('node')
  })

  it('redacts a postgres URI with a colon in its password without relying on authorization text', () => {
    const secret = 'postgres://user:p:ass@db.example/app'
    const view = toApprovalView({
      ...request,
      normalizedTarget: JSON.stringify({ type: 'command', command: { executable: 'node', args: ['-e', `connect("${secret}")`] } })
    }, task)

    const rendered = JSON.stringify(view)
    expect(rendered).not.toContain(secret)
    expect(view.target).toContain('node')
  })

  it('marks approval details truncated when command arguments exceed the visible count or length bounds', () => {
    const extraArgumentView = toApprovalView({
      ...request,
      normalizedTarget: JSON.stringify({ type: 'command', command: { executable: 'tool', args: Array.from({ length: 25 }, (_, index) => `arg-${index}`) } })
    }, task)
    const longArgumentView = toApprovalView({
      ...request,
      normalizedTarget: JSON.stringify({ type: 'command', command: { executable: 'tool', args: ['x'.repeat(321)] } })
    }, task)
    const aggregateView = toApprovalView({
      ...request,
      normalizedTarget: JSON.stringify({ type: 'command', command: { executable: 'tool', args: Array.from({ length: 24 }, () => 'x'.repeat(600)) } })
    }, task)

    expect(extraArgumentView.detailsTruncated).toBe(true)
    expect(extraArgumentView.details).not.toContain('arg-24')
    expect(longArgumentView.detailsTruncated).toBe(true)
    expect(longArgumentView.details).not.toContain('x'.repeat(321))
    expect(aggregateView.detailsTruncated).toBe(true)
  })

  it('never sends sensitive host-patch diff summaries to the renderer', () => {
    const secret = 'postgres://dbuser:plain-password@db.example/app'
    const view = toApprovalView({
      ...request,
      operation: 'fs.apply-host',
      summary: `批准后写回 1 个文件\n--- a/.env\n+++ b/.env\n+DATABASE_URL=${secret}\n+-----BEGIN PRIVATE KEY-----`,
      normalizedTarget: JSON.stringify({ type: 'host-patch', paths: ['.env'], patchHash: 'a'.repeat(64) })
    }, task)

    const rendered = JSON.stringify(view)
    expect(rendered).not.toContain(secret)
    expect(rendered).not.toContain('-----BEGIN PRIVATE KEY-----')
    expect(view.target).toContain('.env')
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
    expect(view.details).toContain('"type": "command"')
    expect(view.detailsTruncated).toBeUndefined()
    expect(request.normalizedTarget).toContain('npm')
  })
})
