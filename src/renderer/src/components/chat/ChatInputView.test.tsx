/**
 * @vitest-environment jsdom
 *
 * ChatInput 的行为与排版约束。
 *
 * 迁移策略说明（对应文档第 10 节「不破坏逻辑的迁移约束」）：
 * 输入区外壳已迁移到 Ant Design X 的**受控** `Sender`（文档 7.3），
 * 但以下能力必须原样保留，因此这里逐条锁定：
 * `/Skill` 与 `@插件` 菜单（含键盘导航）、输入历史、附件与解析状态、
 * 发送/停止链路、Enter 与 Shift+Enter 规则。
 *
 * 先给关键交互补行为测试，再改动展示层。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp, ConfigProvider } from 'antd'
import { StrictMode, act, type ReactElement } from 'react'
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
    <ConfigProvider theme={toAntdTheme(theme)}>
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

  it('一次回车只发送一次（Sender 与本组件不重复提交）', async () => {
    render(wrap(<ChatInput sessionId="s1" />))
    await userEvent.type(screen.getByPlaceholderText('向 AI Agent 发送消息...'), '你好{Enter}')

    await waitFor(() => expect(chatState.send).toHaveBeenCalledTimes(1))
    // 再放一拍，确认没有延迟的第二次调用
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(chatState.send).toHaveBeenCalledTimes(1)
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

  it('发送与停止按钮由同一组 Sender 操作按钮渲染（尺寸与形状一致）', () => {
    const { unmount } = render(wrap(<ChatInput sessionId="s1" />))
    const send = screen.getByRole('button', { name: '发送' })
    const sendClass = send.getAttribute('class') ?? ''
    unmount()

    chatState.sending = { s1: true }
    render(wrap(<ChatInput sessionId="s1" />))
    const stop = screen.getByRole('button', { name: '停止生成' })
    const stopClass = stop.getAttribute('class') ?? ''

    /*
     * 迁移后两者都由 @ant-design/x 的 SendButton / LoadingButton 渲染，
     * 因此共享同一套操作按钮类与圆形形状（同一尺寸、同一位置、同一反馈），
     * 不再是各自写死 h-8 w-8 的自制按钮。
     */
    for (const token of ['ant-sender-actions-btn', 'ant-btn-circle']) {
      expect(sendClass).toContain(token)
      expect(stopClass).toContain(token)
    }
  })
})

/**
 * 迁移契约（文档 7.3）。
 *
 * `Sender` 的类名与提交契约是本文件的实现依据，因此显式断言，
 * 避免「看起来换成了 Sender，实际还是自制 textarea」。
 */
describe('ChatInput 由 Ant Design X Sender 驱动', () => {
  it('使用 Sender 作为输入外壳', () => {
    const { container } = render(wrap(<ChatInput sessionId="s1" />))
    expect(container.querySelector('.ant-sender')).not.toBeNull()
    expect(container.querySelector('textarea.ant-sender-input')).not.toBeNull()
  })

  it('模型菜单点击外部或按 Escape 会关闭', async () => {
    modelState.config = {
      activePresetId: 'deepseek',
      reasoningEffort: 'high',
      presets: [{ id: 'deepseek', name: 'DeepSeek V4', model: 'deepseek-v4-pro' }]
    }
    render(wrap(<ChatInput sessionId="s1" />))
    const trigger = screen.getByRole('button', { name: /DeepSeek V4/ })

    await userEvent.click(trigger)
    const menu = screen.getByRole('listbox', { name: '模型与推理等级' })
    expect(menu).toBeInTheDocument()
    expect(menu).toHaveClass('bg-surface-overlay')
    expect(menu).toHaveStyle({ backgroundColor: 'var(--surface-overlay)' })
    expect(screen.getByRole('button', { name: '配置 / 管理模型' })).toHaveClass('items-center', 'py-2')
    await userEvent.click(screen.getByText('AI 生成的内容可能不准确，请注意甄别'))
    expect(screen.queryByRole('listbox', { name: '模型与推理等级' })).not.toBeInTheDocument()

    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox', { name: '模型与推理等级' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('Skill 菜单里回车只补齐指令，不会同时发送消息', async () => {
    skillState.items = [
      {
        id: 'sk1',
        name: 'demo',
        displayName: 'Demo',
        description: '示例技能',
        active: true,
        enabled: true,
        errors: []
      }
    ]
    render(wrap(<ChatInput sessionId="s1" />))
    const textarea = screen.getByPlaceholderText('向 AI Agent 发送消息...')
    await userEvent.type(textarea, '/dem')

    expect(screen.getByRole('listbox', { name: 'Skill 快捷指令' })).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')

    expect(chatState.send).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('/demo ')
  })

  it('@插件菜单里回车只补齐 mention，不会同时发送消息', async () => {
    pluginState.items = [
      {
        id: 'plug',
        name: 'Plug',
        version: '1.0.0',
        description: '插件',
        enabled: true,
        status: 'ready',
        components: ['tools']
      }
    ]
    render(wrap(<ChatInput sessionId="s1" />))
    const textarea = screen.getByPlaceholderText('向 AI Agent 发送消息...')
    await userEvent.type(textarea, '@pl')

    expect(screen.getByRole('listbox', { name: '插件快捷选择' })).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')

    expect(chatState.send).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('@plug ')
  })

  it('输入历史仍可用：↑ 取回上一条用户消息', async () => {
    chatState.messages = { s1: [{ role: 'user', content: '上一条消息' }] }
    render(wrap(<ChatInput sessionId="s1" />))
    const textarea = screen.getByPlaceholderText('向 AI Agent 发送消息...')

    await userEvent.click(textarea)
    await userEvent.keyboard('{ArrowUp}')

    expect(textarea).toHaveValue('上一条消息')
    expect(chatState.send).not.toHaveBeenCalled()
  })
})


describe('ChatInput 待填文本（技能「立即试用」）', () => {
  it('在 StrictMode 下也能把待填文本写入输入框', async () => {
    // 直接使用真实 uiStore：本用例验证的正是 store 与组件的协作语义
    const { useUiStore } = await import('../../stores/uiStore')
    useUiStore.setState({ pendingPrompt: undefined })

    const theme = resolveTheme({ mode: 'dark', isDark: true })
    render(
      <StrictMode>
        <ConfigProvider theme={toAntdTheme(theme)}>
          <AntdApp>
            <ChatInput sessionId="s1" />
          </AntdApp>
        </ConfigProvider>
      </StrictMode>
    )

    // 模拟「立即试用」设置待填文本
    act(() => { useUiStore.getState().setPendingPrompt('/frontend-app-builder ', 's1') })

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('/frontend-app-builder ')
    })
    await waitFor(() => expect(useUiStore.getState().pendingPrompt).toBeUndefined())
  })

  it('只填入目标会话，消费后切换回来也不会再次出现', async () => {
    const { useUiStore } = await import('../../stores/uiStore')
    useUiStore.setState({ pendingPrompt: undefined })
    act(() => { useUiStore.getState().setPendingPrompt('/review ', 's2') })

    const view = render(wrap(<ChatInput sessionId="s1" />))
    const box = await screen.findByRole('textbox')
    expect(box).toHaveValue('')

    view.rerender(wrap(<ChatInput sessionId="s2" />))
    await waitFor(() => expect(box).toHaveValue('/review '))
    await waitFor(() => expect(useUiStore.getState().pendingPrompt).toBeUndefined())

    await userEvent.clear(box)
    view.rerender(wrap(<ChatInput sessionId="s1" />))
    expect(box).toHaveValue('')
    view.rerender(wrap(<ChatInput sessionId="s2" />))
    expect(box).toHaveValue('')
  })

  it('旧输入框不能清除后续创建的新注入', async () => {
    const { useUiStore } = await import('../../stores/uiStore')
    useUiStore.setState({ pendingPrompt: undefined })
    act(() => { useUiStore.getState().setPendingPrompt('/first ', 's1') })
    const firstId = useUiStore.getState().pendingPrompt!.id
    act(() => { useUiStore.getState().setPendingPrompt('/second ', 's2') })
    act(() => { useUiStore.getState().clearPendingPrompt(firstId) })
    expect(useUiStore.getState().pendingPrompt).toMatchObject({ text: '/second ', sessionId: 's2' })
  })
})
