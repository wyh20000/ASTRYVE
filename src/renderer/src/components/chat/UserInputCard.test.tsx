import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UserInputRequest } from '@shared/types'
import { UserInputCard } from './ChatInput'

describe('UserInputCard', () => {
  it('labels choices alphabetically and marks the recommended choice', () => {
    const request: UserInputRequest = {
      id: 'request-1',
      sessionId: 'session-card',
      questions: [{
        id: 'scope',
        question: '这次优化的覆盖范围？',
        options: [
          { label: '全局系统优化', recommended: true },
          { label: '聚焦主界面' },
          { label: '只修已知痛点' }
        ]
      }]
    }
    const html = renderToStaticMarkup(<UserInputCard request={request} onResolved={() => undefined} />)

    expect(html).toContain('A. 全局系统优化')
    expect(html).toContain('B. 聚焦主界面')
    expect(html).toContain('C. 只修已知痛点')
    expect(html).toContain('推荐')
  })
})
