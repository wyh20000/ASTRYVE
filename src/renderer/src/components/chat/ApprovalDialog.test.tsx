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
      expiresAt: Date.now() + 60_000
    }
    const html = renderToStaticMarkup(<ApprovalDialogView request={request} onClear={() => undefined} />)
    expect(html).toContain('确认运行命令')
    expect(html).toContain('npm test')
    expect(html).toContain('查看完整参数')
    expect(html).toContain('本任务允许相同命令')
    expect(html).toContain('max-h-44')
  })
})
