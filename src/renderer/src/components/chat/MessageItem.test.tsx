/**
 * @vitest-environment jsdom
 *
 * 本文件含 DOM 交互断言（复制按钮可聚焦、悬停可用），
 * 因此需要 jsdom；其余用例仍用 renderToStaticMarkup。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  /**
   * 原断言检查的是 `group-hover:opacity-100` 这个 Tailwind class。
   * 迁移到 Ant Design X 的 Bubble 后复制按钮改用全局 IconButton，
   * 隐藏方式变化，class 断言随之失效。
   *
   * 这里改为断言**用户可观察的行为**：复制操作存在、可被键盘触达、
   * 悬停后可用（Tooltip 名称可读）。这样换实现不会误报，
   * 但真的删掉复制能力仍然会被拦住。
   */
  it('keeps a discoverable copy action for user text', async () => {
    const message: Message = {
      id: 'message-3', sessionId: 'session-1', role: 'user', content: '批准', status: 'done', timestamp: 1,
      attachments: [{ id: 'image-1', kind: 'image', name: 'reference.png', contentType: 'image/png', dataRef: 'data:image/png;base64,AA==' }]
    }

    render(<MessageItem message={message} />)

    // 复制操作存在且有可访问名称，键盘可聚焦
    const copy = screen.getByRole('button', { name: '复制消息' })
    expect(copy).toBeInTheDocument()
    await userEvent.tab()
    expect(copy).toHaveFocus()

    // 悬停后仍可用（Tooltip 提供名称）
    await userEvent.hover(copy)
    expect(copy).toBeEnabled()

    // 附件预览未被迁移破坏
    expect(screen.getByAltText('reference.png')).toBeInTheDocument()
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
