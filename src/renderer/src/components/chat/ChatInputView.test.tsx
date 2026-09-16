/**
 * @vitest-environment jsdom
 *
 * ChatInput 的行为与排版约束。
 *
 * 迁移策略说明（对应文档第 10 节「不破坏逻辑的迁移约束」）：
 * ChatInput 的输入框是自定义的 autosize textarea，Skill / 插件菜单是带
 * 键盘导航的自定义 listbox。文档 7.3 明确：组件库无法无损表达现有能力时，
 * 保留现有组件、只统一视觉。因此这里**不替换结构**，
 * 只做排版（14px）与控件可访问性（IconButton）层面的约束。
 *
 * 先给关键交互补行为测试，再改动展示层。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp, ConfigProvider } from 'antd'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toAntdTheme } from '../../theme/antdTheme'
import { resolveTheme } from '../../theme/tokens'

/* ---------------- store 桩 ---------------- */

const chatState = vi.hoisted(() => ({
  // send(sessionId, content, attachments) 是位置参数，且组件会读取 result.ok。
  // 显式声明参数类型，否则 mock.calls[0][0] 无法索引。
  send: vi.fn(
    async (_sessionId: string, _content: string, _attachments?: unknown[]) => ({
      ok: true,
      data: { id: 'm1' }
    })
  ),
  stop: vi.fn(),
  sending: {} as Record<string, boolean>,
  inputRequests: {} as Record<string, unknown>,
  clearInputRequest: vi.fn(),
  messages: {} as Record<string, Array<{ role: string; content: string }>>
}))

const modelState = vi.hoisted(() => ({ config: null as unknown }))
const sessionState = vi.hoisted(() => ({ sessions: [] as unknown[] }))
const workspaceState = vi.hoisted(() => ({ recent: [] as unknown[] }))
const skillState = vi.hoisted(() => ({ items: [] as unknown[], load: vi.fn() }))
const pluginState = vi.hoisted(() => ({ items: [] as unknown[], load: vi.fn() }))

vi.mock('../../stores/chatStore', () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) => selector(chatState)
}))
vi.mock('../../stores/modelStore', () => ({
  useModelStore: (selector: (s: Record<string, unknown>) => unknown) => selector(modelState)
}))
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (selector: (s: Record<string, unknown>) => unknown) => selector(sessionState)
}))
vi.mock('../../stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) => selector(workspaceState)
}))
vi.mock('../../stores/skillStore', () => ({
  useSkillStore: (selector: (s: Record<string, unknown>) => unknown) => selector(skillState)
}))
vi.mock('../../stores/pluginStore', () => ({
  usePluginStore: (selector: (s: Record<string, unknown>) => unknown) => selector(pluginState)
}))

import { ChatInput } from './ChatInput'

/** 与 App.tsx 相同的 Provider，外加 AntdApp 以提供 message API */
function wrap(ui: ReactElement): ReactElement {
  const theme = resolveTheme({ mode: 'dark', isDark: true })
  return (
    <ConfigProvider theme={toAntdTheme(theme, 'dark')}>
      <AntdApp>{ui}</AntdApp>
    </ConfigProvider>
  )
}

/** 收集子树内出现的 text-[Npx] 字号（SVG 的 className 不是字符串） */
function fontSizes(container: HTMLElement): string[] {
  const sizes = new Set<string>()
  for (const el of Array.from(container.querySelectorAll('*'))) {
    const cls = el.getAttribute('class')
    if (!cls) continue
    for (const m of cls.matchAll(/text-\[(\d+)px\]/g)) sizes.add(m[1])
  }
  return [...sizes].sort()
}

beforeEach(() => {
  chatState.send.mockReset()
  chatState.send.mockImplementation(
    async (_sessionId: string, _content: string, _attachments?: unknown[]) => ({
      ok: true,
      data: { id: 'm1' }
    })
  )
  chatState.stop.mockReset()
  chatState.sending = {}
  chatState.inputRequests = {}
  chatState.messages = {}
  modelState.config = null
  sessionState.sessions = []
  workspaceState.recent = []
  skillState.items = []
  pluginState.items = []
  // window.agent 由 src/test/setup.ts 提供最小桩；这里按需补上 message 通道，
  // 不整对象重定义（会触发 Cannot redefine property）。
  const agent = window.agent as unknown as Record<string, unknown>
  agent.message = {
    respondInput: async () => ({ ok: true, data: undefined })
  }
})

describe('ChatInput 基本结构', () => {
  it('渲染输入框与提示语', () => {
    render(wrap(<ChatInput sessionId="s1" />))
    expect(screen.getByPlaceholderText('向 AI Agent 发送消息...')).toBeInTheDocument()
    expect(screen.getByText('AI 生成的内容可能不准确，请注意甄别')).toBeInTheDocument()
  })

  it('空输入时发送按钮不可用', () => {
    render(wrap(<ChatInput sessionId="s1" />))
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  })

  it('输入内容后发送按钮可用', async () => {
    render(wrap(<ChatInput sessionId="s1" />))
    await userEvent.type(screen.getByPlaceholderText('向 AI Agent 发送消息...'), '你好')
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
  })

  it('AI 需要用户输入时禁用输入框并替换提示语', () => {
    chatState.inputRequests = { s1: { id: 'r1', sessionId: 's1', questions: [] } }
    render(wrap(<ChatInput sessionId="s1" />))
    expect(screen.getByPlaceholderText('请先回答上方问题…')).toBeDisabled()
  })
})

describe('ChatInput 发送行为', () => {
  it('Enter 触发发送并把内容交给 store', async () => {
    render(wrap(<ChatInput sessionId="s1" />))
    const textarea = screen.getByPlaceholderText('向 AI Agent 发送消息...')
    await userEvent.type(textarea, '你好{Enter}')

    await waitFor(() => expect(chatState.send).toHaveBeenCalled())
    // 位置参数：sessionId, content, attachments
    expect(chatState.send.mock.calls[0][0]).toBe('s1')
    expect(chatState.send.mock.calls[0][1]).toBe('你好')
    expect(Array.isArray(chatState.send.mock.calls[0][2])).toBe(true)
  })

  it('Shift+Enter 换行而不发送', async () => {
    render(wrap(<ChatInput sessionId="s1" />))
    const textarea = screen.getByPlaceholderText('向 AI Agent 发送消息...')
    await userEvent.type(textarea, '第一行{Shift>}{Enter}{/Shift}第二行')

    expect(chatState.send).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('第一行\n第二行')
  })

  it('生成中显示停止按钮并可触发 stop', async () => {
    chatState.sending = { s1: true }
    render(wrap(<ChatInput sessionId="s1" />))
    const stopButton = screen.getByRole('button', { name: '停止生成' })
    await userEvent.click(stopButton)
    expect(chatState.stop).toHaveBeenCalledWith('s1')
  })
})

describe('ChatInput 排版约束', () => {
  it('所有可见文字均不小于 14px', () => {
    render(wrap(<ChatInput sessionId="s1" />))
    const { container } = { container: document.body }
    expect(fontSizes(container as HTMLElement)).toEqual(['14'])
  })

  it('输入框使用 14px 正文层级', () => {
    render(wrap(<ChatInput sessionId="s1" />))
    const textarea = screen.getByPlaceholderText('向 AI Agent 发送消息...')
    expect(textarea.getAttribute('class')).toContain('text-[14px]')
  })
})

describe('ChatInput 附件与工具区可访问性', () => {
  it('附件与图片入口具有可访问名称', () => {
    render(wrap(<ChatInput sessionId="s1" />))
    expect(screen.getByRole('button', { name: /附件/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /图片/ })).toBeInTheDocument()
  })

  it('发送与停止按钮共享同一尺寸与位置', () => {
    const { unmount } = render(wrap(<ChatInput sessionId="s1" />))
    const send = screen.getByRole('button', { name: '发送' })
    const sendClass = send.getAttribute('class') ?? ''
    unmount()

    chatState.sending = { s1: true }
    render(wrap(<ChatInput sessionId="s1" />))
    const stop = screen.getByRole('button', { name: '停止生成' })
    const stopClass = stop.getAttribute('class') ?? ''

    for (const token of ['h-8', 'w-8', 'rounded-full']) {
      expect(sendClass).toContain(token)
      expect(stopClass).toContain(token)
    }
  })
})
