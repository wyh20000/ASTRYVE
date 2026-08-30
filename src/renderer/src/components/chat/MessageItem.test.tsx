import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Message } from '@shared/types'
import { MessageItem } from './MessageItem'

const message = (content: string): Message => ({
  id: 'assistant-1',
  sessionId: 'conversation-1',
  role: 'assistant',
  content,
  status: 'streaming',
  timestamp: 1
})

describe('MessageItem 流式状态', () => {
  it('首字到达前展示回答骨架', () => {
    expect(renderToStaticMarkup(<MessageItem message={message('')} />)).toContain(
      'aria-label="正在生成回答"'
    )
  })

  it('文字到达后展示闪烁光标', () => {
    const html = renderToStaticMarkup(<MessageItem message={message('已生成')} />)
    expect(html).toContain('stream-cursor')
    expect(html).toContain('aria-label="正在生成"')
  })
})
