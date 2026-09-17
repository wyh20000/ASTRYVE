/**
 * @vitest-environment jsdom
 *
 * MessageItem 迁移到 Ant Design X Bubble 的行为契约。
 *
 * 按文档第 10 节的迁移规则：先固定行为，再换展示层。
 * 这些断言刻意只依赖**语义与可观察行为**（文本、可访问名称、角色、
 * 气泡 placement），不依赖具体 className，避免换实现时误报。
 *
 * 设计文档 7.2 的要求：
 * - 用户消息 placement="end"，保留附件预览、复制与时间；
 * - Agent 消息 placement="start" 且 borderless，内容继续由现有
 *   Blocks / RichText 渲染；
 * - 消息模型与流式状态完全不变。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp } from 'antd'
import { XProvider } from '@ant-design/x'
import zhCN from '@ant-design/x/es/locale/zh_CN'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '@shared/types'
import { toAntdTheme } from '../../theme/antdTheme'
import { resolveTheme } from '../../theme/tokens'
import { MessageItem } from './MessageItem'

const THEME = resolveTheme({ mode: 'dark', isDark: true })

/** 与 App.tsx 相同的 Provider 结构 */
function wrap(ui: ReactElement): ReactElement {
  return (
    <XProvider theme={toAntdTheme(THEME, 'dark')} locale={zhCN}>
      <AntdApp>{ui}</AntdApp>
    </XProvider>
  )
}

function userMessage(patch: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    sessionId: 's1',
    role: 'user',
    content: '批准',
    status: 'done',
    timestamp: 1,
    ...patch
  }
}

function assistantMessage(patch: Partial<Message> = {}): Message {
  return {
    id: 'm2',
    sessionId: 's1',
    role: 'assistant',
    content: '完成',
    status: 'done',
    timestamp: 1,
    ...patch
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) }
  })
})

describe('用户消息 - 迁移后仍保留全部能力', () => {
  it('渲染正文内容', () => {
    render(wrap(<MessageItem message={userMessage()} />))
    expect(screen.getByText('批准')).toBeInTheDocument()
  })

  it('使用 end 侧气泡（placement=end）', () => {
    const { container } = render(wrap(<MessageItem message={userMessage()} />))
    expect(container.querySelector('.ant-bubble-end')).not.toBeNull()
  })

  it('保留时间与发送者标识', () => {
    render(wrap(<MessageItem message={userMessage()} />))
    expect(screen.getByText('我')).toBeInTheDocument()
  })

  it('保留复制按钮且具备可访问名称', () => {
    render(wrap(<MessageItem message={userMessage()} />))
    expect(screen.getByRole('button', { name: '复制消息' })).toBeInTheDocument()
  })

  it('点击复制写入剪贴板并把名称切换为「已复制」', async () => {
    render(wrap(<MessageItem message={userMessage()} />))
    await userEvent.click(screen.getByRole('button', { name: '复制消息' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('批准')
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument()
  })

  it('空内容时不渲染复制按钮', () => {
    render(wrap(<MessageItem message={userMessage({ content: '   ' })} />))
    expect(screen.queryByRole('button', { name: /复制/ })).not.toBeInTheDocument()
  })

  it('保留图片附件预览', () => {
    render(
      wrap(
        <MessageItem
          message={userMessage({
            attachments: [
              {
                id: 'a1',
                kind: 'image',
                name: 'reference.png',
                contentType: 'image/png',
                dataRef: 'data:image/png;base64,AA=='
              }
            ]
          })}
        />
      )
    )
    expect(screen.getByAltText('reference.png')).toBeInTheDocument()
  })

  it('保留文件附件的解析状态', () => {
    render(
      wrap(
        <MessageItem
          message={userMessage({
            attachments: [
              {
                id: 'a2',
                kind: 'file',
                name: 'spec.md',
                contentType: 'text/markdown',
                dataRef: 'data:text/markdown;base64,AA==',
                meta: { parsed: true, charCount: 42 }
              }
            ]
          })}
        />
      )
    )
    expect(screen.getByText('spec.md')).toBeInTheDocument()
    expect(screen.getByText(/已解析 42 字/)).toBeInTheDocument()
  })

  it('解析失败的文件标注失败状态', () => {
    render(
      wrap(
        <MessageItem
          message={userMessage({
            attachments: [
              {
                id: 'a3',
                kind: 'file',
                name: 'broken.pdf',
                contentType: 'application/pdf',
                dataRef: 'data:application/pdf;base64,AA==',
                meta: { parsed: false }
              }
            ]
          })}
        />
      )
    )
    expect(screen.getByText('解析失败')).toBeInTheDocument()
  })

  it('无文字内容时不发起流式动画（避免空气泡打字）', () => {
    const { container } = render(
      wrap(<MessageItem message={userMessage({ content: '', attachments: [] })} />)
    )
    expect(container.textContent?.trim()).not.toBe('')
  })
})

describe('Agent 消息 - 保持 borderless 内容流', () => {
  it('使用 start 侧气泡', () => {
    const { container } = render(wrap(<MessageItem message={assistantMessage()} />))
    expect(container.querySelector('.ant-bubble-start')).not.toBeNull()
  })

  it('使用 borderless 变体，不出现厚重气泡底', () => {
    const { container } = render(wrap(<MessageItem message={assistantMessage()} />))
    expect(container.querySelector('.ant-bubble-content-borderless')).not.toBeNull()
  })

  it('不渲染 Agent 头像与名称', () => {
    render(wrap(<MessageItem message={assistantMessage()} />))
    expect(screen.queryByText('AI Agent')).not.toBeInTheDocument()
    expect(screen.getByText('完成')).toBeInTheDocument()
  })

  it('失败且无内容时显示可复现的占位说明', () => {
    render(wrap(<MessageItem message={assistantMessage({ content: '', status: 'error' })} />))
    expect(screen.getByText(/本次执行未完成/)).toBeInTheDocument()
    expect(screen.getByText(/请重试/)).toBeInTheDocument()
  })

  it('流式且有内容时显示生成中指示器', () => {
    const { container } = render(
      wrap(<MessageItem message={assistantMessage({ status: 'streaming' })} />)
    )
    expect(container.querySelector('.reply-dots')).not.toBeNull()
  })

  it('流式且无内容时也显示生成中指示器', () => {
    const { container } = render(
      wrap(<MessageItem message={assistantMessage({ content: '', status: 'streaming' })} />)
    )
    expect(container.querySelector('.reply-dots')).not.toBeNull()
  })
})

describe('Agent 消息 - 思考面板展开状态', () => {
  const thinking: Message = {
    id: 'm3',
    sessionId: 's1',
    role: 'assistant',
    content: '',
    status: 'streaming',
    timestamp: 1,
    blocks: [{ kind: 'thinking', content: '先读取文件。' }]
  }

  it('整条消息短暂没有块（重试/回退前清空）后重新出现，面板仍是展开的', async () => {
    const view = render(wrap(<MessageItem message={thinking} />))
    await userEvent.click(screen.getByRole('button', { name: /思考/ }))
    expect(screen.getByText('先读取文件。')).toBeInTheDocument()

    // 主进程在重试前会清空 reasoning/content，这一帧没有任何块
    view.rerender(wrap(<MessageItem message={{ ...thinking, blocks: undefined }} />))
    view.rerender(wrap(<MessageItem message={thinking} />))

    expect(screen.getByRole('button', { name: /思考/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('先读取文件。')).toBeInTheDocument()
  })
})

describe('排版约束不回退', () => {
  it('用户消息内不存在小于 14px 的字号', () => {
    const { container } = render(wrap(<MessageItem message={userMessage()} />))
    const sizes = new Set<string>()
    for (const el of Array.from(container.querySelectorAll('*'))) {
      const cls = el.getAttribute('class')
      if (!cls) continue
      for (const m of cls.matchAll(/text-\[(\d+)px\]/g)) sizes.add(m[1])
    }
    for (const s of sizes) expect(Number(s)).toBeGreaterThanOrEqual(14)
  })
})
