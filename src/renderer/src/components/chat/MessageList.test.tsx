/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '@shared/types'
import { MessageList } from './MessageList'

function message(id: string, content = '回答内容'): Message {
  return {
    id,
    sessionId: 'session-1',
    role: 'assistant',
    content,
    status: 'streaming',
    timestamp: 0
  }
}

function scrollElement(container: HTMLElement): HTMLDivElement {
  return container.firstElementChild?.firstElementChild as HTMLDivElement
}

function setScrollMetrics(element: HTMLDivElement, values: { scrollHeight: number; clientHeight: number; scrollTop?: number }): void {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: values.scrollHeight },
    clientHeight: { configurable: true, value: values.clientHeight },
    scrollTop: { configurable: true, writable: true, value: values.scrollTop ?? 0 }
  })
}

describe('MessageList 流式滚动', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('用户滚轮操作后暂停跟随，新增内容不会抢回滚动位置', async () => {
    const view = render(<MessageList messages={[message('m1')]} />)
    const scroll = scrollElement(view.container)
    setScrollMetrics(scroll, { scrollHeight: 1000, clientHeight: 400, scrollTop: 320 })

    fireEvent.wheel(scroll, { deltaY: -240 })
    expect(screen.getByRole('button', { name: '回到底部' })).toBeInTheDocument()

    setScrollMetrics(scroll, { scrollHeight: 1400, clientHeight: 400, scrollTop: 320 })
    view.rerender(<MessageList messages={[message('m1', '新的流式内容')]} />)
    await act(async () => {})

    expect(scroll.scrollTop).toBe(320)
    expect(screen.getByRole('button', { name: '查看新内容并回到底部' })).toHaveTextContent('新内容')
  })

  it('点击回到底部后恢复跟随，并将按钮固定在滚动区域底部', async () => {
    const view = render(<MessageList messages={[message('m1')]} />)
    const scroll = scrollElement(view.container)
    setScrollMetrics(scroll, { scrollHeight: 1000, clientHeight: 400, scrollTop: 320 })

    fireEvent.pointerDown(scroll)
    const button = screen.getByRole('button', { name: '回到底部' })
    expect(button).toHaveClass('absolute', 'bottom-3')
    expect(button).toHaveTextContent('回到底部')

    fireEvent.click(button)
    expect(scroll.scrollTop).toBe(1000)
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument()

    setScrollMetrics(scroll, { scrollHeight: 1400, clientHeight: 400, scrollTop: 1000 })
    view.rerender(<MessageList messages={[message('m1', '继续生成')]} />)
    await act(async () => {})

    expect(scroll.scrollTop).toBe(1400)
  })

  it('已经在底部时向下滚轮不会显示回到底部按钮', () => {
    const view = render(<MessageList messages={[message('m1')]} />)
    const scroll = scrollElement(view.container)
    setScrollMetrics(scroll, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })

    fireEvent.wheel(scroll, { deltaY: 240 })

    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument()
  })

  it('用户手动滚回底部后恢复跟随并隐藏按钮', () => {
    const view = render(<MessageList messages={[message('m1')]} />)
    const scroll = scrollElement(view.container)
    setScrollMetrics(scroll, { scrollHeight: 1000, clientHeight: 400, scrollTop: 320 })

    fireEvent.wheel(scroll, { deltaY: -240 })
    expect(screen.getByRole('button', { name: '回到底部' })).toBeInTheDocument()

    setScrollMetrics(scroll, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })
    fireEvent.scroll(scroll)

    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument()
  })
})
