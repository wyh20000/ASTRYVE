/**
 * @vitest-environment jsdom
 *
 * Blocks.tsx 迁移后的排版与可访问性约束。
 *
 * 对应设计文档：
 * - 4.2 字号层级：块级内容统一 14px，不再出现 9~13px；
 * - 6 全局组件层：图标按钮必须有可访问名称。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MessageBlock, MessageStatus } from '@shared/types'
import { Blocks, RichText } from './Blocks'

/**
 * 收集子树里出现的所有 text-[Npx] 字号。
 *
 * 注意：SVG 元素的 className 是 SVGAnimatedString 而非字符串，
 * 因此必须用 getAttribute('class')，不能直接读 el.className。
 */
function collectFontSizes(container: HTMLElement): string[] {
  const sizes = new Set<string>()
  for (const el of Array.from(container.querySelectorAll('*'))) {
    const cls = el.getAttribute('class')
    if (!cls) continue
    for (const match of cls.matchAll(/text-\[(\d+)px\]/g)) sizes.add(match[1])
  }
  return [...sizes].sort()
}

function renderBlocks(blocks: MessageBlock[], status: MessageStatus = 'done'): HTMLElement {
  return render(<Blocks blocks={blocks} status={status} />).container
}

describe('块级排版统一为 14px', () => {
  it('代码块正文与语言标签均为 14px', () => {
    const container = renderBlocks([{ kind: 'code', language: 'ts', code: 'const a = 1' }])
    expect(collectFontSizes(container)).toEqual(['14'])
  })

  it('命令块展开后输出使用 14px 与 21px 行高', async () => {
    const container = renderBlocks([
      {
        kind: 'command',
        callId: 'call-1',
        executable: 'npm',
        args: ['test'],
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        truncated: false,
        durationMs: 12
      }
    ])
    // 退出码为 0 时默认收起，需要先展开
    await userEvent.click(screen.getByRole('button', { name: /npm test/ }))

    const pre = container.querySelector('pre')
    expect(pre, '展开后应渲染输出区域').not.toBeNull()
    expect(pre?.getAttribute('class')).toContain('text-[14px]')
    expect(pre?.getAttribute('class')).toContain('leading-[21px]')
  })

  it('任务报告使用 14px', () => {
    const container = renderBlocks([
      { kind: 'report', files: [], commands: [], tests: [], approvals: [], unresolved: [] }
    ])
    expect(container.textContent).toContain('任务报告')
    expect(collectFontSizes(container)).toEqual(['14'])
  })

  it('引用来源列表使用 14px', () => {
    const container = renderBlocks([
      { kind: 'sources', sources: [{ title: '文档', url: 'https://example.com' }] }
    ])
    expect(collectFontSizes(container)).toEqual(['14'])
  })

  it('计划与文件列表使用 14px', () => {
    const container = renderBlocks([
      { kind: 'plan', items: [{ order: 1, title: '第一步', done: false }] },
      { kind: 'files', files: [{ path: 'a.ts', addedLines: 3 }] }
    ])
    expect(collectFontSizes(container)).toEqual(['14'])
  })

  it('思考过程展开后标题与正文均为 14px', async () => {
    const container = renderBlocks([{ kind: 'thinking', content: '分析中', done: false }])
    await userEvent.click(screen.getByRole('button', { name: /思考/ }))
    expect(collectFontSizes(container)).toEqual(['14'])
    expect(screen.getByText('分析中')).toBeInTheDocument()
  })

  it('差异块头部与页脚均为 14px', () => {
    const container = renderBlocks([
      {
        kind: 'diff',
        taskId: 't1',
        patchHash: 'abc123',
        linesAdded: 1,
        linesDeleted: 0,
        files: [
            { path: 'a.ts', status: 'modified', linesAdded: 1, linesDeleted: 0, diff: '+a' }
          ]
      }
    ])
    expect(collectFontSizes(container)).toEqual(['14'])
  })
})

describe('图标按钮具备可访问名称', () => {
  it('代码块复制按钮通过 label 暴露名称', () => {
    renderBlocks([{ kind: 'code', language: 'ts', code: 'x' }])
    expect(screen.getByRole('button', { name: '复制代码' })).toBeInTheDocument()
  })

  it('复制后按钮名称变为「已复制」', async () => {
    // jsdom 没有 navigator.clipboard，补一个即可走通复制分支
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    renderBlocks([{ kind: 'code', language: 'ts', code: 'x' }])
    await userEvent.click(screen.getByRole('button', { name: '复制代码' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument())
  })

  it('思考过程的展开/收起由标题按钮承担，状态由 aria-expanded 暴露', async () => {
    renderBlocks([{ kind: 'thinking', content: '分析中', done: false }], 'streaming')

    /*
     * 阶段 C（文档 7.5）后思考过程外壳改为 Ant Design X 的 `Think`，
     * 展开/收起不再有独立的「收起」按钮，而是由标题按钮统一承担。
     * 这里锁定的是**能力**（可键盘展开与收起、状态可读），不是旧按钮文案。
     */
    const toggle = screen.getByRole('button', { name: /思考/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('分析中')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('分析中')).toBeInTheDocument()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('危险操作使用语义化按钮', () => {
  it('拒绝文件按钮为 danger 语义', () => {
    renderBlocks(
      [
        {
          kind: 'diff',
          taskId: 't1',
          patchHash: 'abc',
          linesAdded: 1,
          linesDeleted: 0,
          files: [
            { path: 'a.ts', status: 'modified', linesAdded: 1, linesDeleted: 0, diff: '+a' }
          ]
        }
      ],
      'streaming'
    )
    expect(screen.getByRole('button', { name: '拒绝此文件' })).toHaveClass('ant-btn-dangerous')
  })

  it('非流式状态下不提供拒绝入口', () => {
    renderBlocks(
      [
        {
          kind: 'diff',
          taskId: 't1',
          patchHash: 'abc',
          linesAdded: 1,
          linesDeleted: 0,
          files: [
            { path: 'a.ts', status: 'modified', linesAdded: 1, linesDeleted: 0, diff: '+a' }
          ]
        }
      ],
      'done'
    )
    expect(screen.queryByRole('button', { name: '拒绝此文件' })).not.toBeInTheDocument()
  })
})

describe('RichText 仍正常渲染 markdown 与代码块', () => {
  it('普通段落走 markdown 渲染', () => {
    const { container } = render(<RichText text="普通**加粗**文本" />)
    expect(container.querySelector('strong')).not.toBeNull()
  })

  it('围栏代码块走带语言标签的自定义渲染', () => {
    render(<RichText text={'说明\n\n```ts\nconst a = 1\n```'} />)
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
  })
})

/**
 * 迁移契约（文档 7.5）。
 *
 * 与侧栏会话列表同理：这里显式断言类名，确保思考过程与引用来源
 * 真的由 Ant Design X 的 `Think` / `Sources` 渲染，
 * 而不是换成了一个长得像的自制外壳。
 */
describe('结构化内容由 Ant Design X 组件驱动', () => {
  it('思考过程使用 Think', () => {
    const container = renderBlocks([{ kind: 'thinking', content: '分析中' }])
    expect(container.querySelector('.ant-think')).not.toBeNull()
  })

  it('思考过程的标题按钮可键盘聚焦（Think 标题行本身不可聚焦）', async () => {
    renderBlocks([{ kind: 'thinking', content: '分析中' }], 'streaming')
    await userEvent.tab()
    expect(screen.getByRole('button', { name: /思考/ })).toHaveFocus()
  })

  it('引用来源使用 Sources 渲染条目链接', () => {
    const container = renderBlocks([
      {
        kind: 'sources',
        sources: [
          { title: 'Kimi 文档', url: 'https://platform.kimi.com/docs' },
          { title: '规范', url: 'https://example.com/spec' }
        ]
      }
    ])

    expect(container.querySelector('.ant-sources')).not.toBeNull()
    const links = Array.from(container.querySelectorAll('.ant-sources-link'))
    expect(links).toHaveLength(2)
    // 链接必须真的可点且指向原始 URL，外链安全属性不能丢
    expect(links[0].getAttribute('href')).toBe('https://platform.kimi.com/docs')
    expect(links[0].getAttribute('target')).toBe('_blank')
    expect(links[0].getAttribute('rel')).toContain('noopener')
  })

  it('引用来源折叠后隐藏列表，且状态由 aria-expanded 暴露', async () => {
    const container = renderBlocks([
      { kind: 'sources', sources: [{ title: 'Kimi 文档', url: 'https://platform.kimi.com/docs' }] }
    ])

    const toggle = screen.getByRole('button', { name: /引用来源/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('.ant-sources-link')).not.toBeNull()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})
