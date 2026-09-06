import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Message } from '@shared/types'
import { MessageItem } from './MessageItem'

describe('MessageItem', () => {
  it('renders a persistent placeholder for an empty failed assistant message', () => {
    const message: Message = {
      id: 'message-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      status: 'error',
      timestamp: 1
    }

    const html = renderToStaticMarkup(<MessageItem message={message} />)
    expect(html).toContain('本次执行未完成')
    expect(html).toContain('请重试')
  })
})
