import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ApprovalDialogView } from './ApprovalDialog'
import type { ApprovalUiRequest } from '@shared/types'

describe('ApprovalDialog', () => {
  it('renders a compact summary and keeps long parameters collapsed', () => {
    const request: ApprovalUiRequest = {
      id: 'approval-1', sessionId: 'session-1', title: '确认运行命令', summary: '运行项目测试',
      workspace: 'workspace', environment: 'Docker 沙箱', operation: '运行命令', risk: '中等风险',
      target: 'npm test', details: '{\n  "timeoutMs": 120000\n}', scopeOptions: ['once', 'task-prefix'],
      toolName: 'process.run', callId: 'call-1', permissionBasis: 'ask-every-time · EXPLICIT_APPROVAL_REQUIRED',
      expiresAt: Date.now() + 60_000
    }
    const html = renderToStaticMarkup(<ApprovalDialogView request={request} onClear={() => undefined} />)
    expect(html).toContain('确认运行命令')
    expect(html).toContain('npm test')
    expect(html).toContain('查看可信详情与参数摘要')
    expect(html).toContain('process.run')
    expect(html).toContain('call-1')
    expect(html).toContain('EXPLICIT_APPROVAL_REQUIRED')
    expect(html).toContain('本任务允许相同命令')
    expect(html).toContain('max-h-44')
  })

  it('warns that approval remains bound to complete parameters when a summary is truncated', () => {
    const request: ApprovalUiRequest = {
      id: 'approval-2', sessionId: 'session-1', title: '确认运行命令', summary: '运行项目测试',
      workspace: 'workspace', environment: 'Docker 沙箱', operation: '运行命令', risk: '中等风险',
      target: 'tool arg', details: '{"type":"command"}', detailsTruncated: true, scopeOptions: ['once'],
      toolName: 'process.run', callId: 'call-2', permissionBasis: 'ask-every-time · EXPLICIT_APPROVAL_REQUIRED',
      expiresAt: Date.now() + 60_000
    }
    const html = renderToStaticMarkup(<ApprovalDialogView request={request} onClear={() => undefined} />)
    expect(html).toContain('审批仍绑定完整参数')
  })
})
