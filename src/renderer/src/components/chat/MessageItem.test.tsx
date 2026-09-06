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

  it('omits the assistant avatar and name', () => {
    const message: Message = {
      id: 'message-2', sessionId: 'session-1', role: 'assistant', content: '完成', status: 'done', timestamp: 1
    }
    const html = renderToStaticMarkup(<MessageItem message={message} />)
    expect(html).not.toContain('AI Agent')
    expect(html).toContain('完成')
  })

  it('shows a hover copy action for user text', () => {
    const message: Message = {
      id: 'message-3', sessionId: 'session-1', role: 'user', content: '批准', status: 'done', timestamp: 1,
      attachments: [{ id: 'image-1', kind: 'image', name: 'reference.png', contentType: 'image/png', dataRef: 'data:image/png;base64,AA==' }]
    }
    const html = renderToStaticMarkup(<MessageItem message={message} />)
    expect(html).toContain('复制消息')
    expect(html).toContain('group-hover:opacity-100')
    expect(html).toContain('reference.png')
  })

  it('uses bouncing dots instead of a typing cursor while streaming text', () => {
    const message: Message = {
      id: 'message-4', sessionId: 'session-1', role: 'assistant', content: '正在处理', status: 'streaming', timestamp: 1
    }
    const html = renderToStaticMarkup(<MessageItem message={message} />)
    expect(html).toContain('reply-dots')
    expect(html).not.toContain('stream-cursor')
  })
})
