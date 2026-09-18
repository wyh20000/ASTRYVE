/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { IconButton } from './IconButton'

const icon = <svg data-testid="glyph" />

describe('IconButton - 可访问性', () => {
  it('label 作为可访问名称（无可见文字时必须存在）', () => {
    render(<IconButton icon={icon} label="收起侧栏" />)
    expect(screen.getByRole('button', { name: '收起侧栏' })).toBeInTheDocument()
  })

  it('悬停后显示以 label 为文案的 Tooltip', async () => {
    render(<IconButton icon={icon} label="新建对话" />)
    const button = screen.getByRole('button', { name: '新建对话' })

    await userEvent.hover(button)
    await waitFor(() => {
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toHaveTextContent('新建对话')
      expect(tooltip).toHaveStyle({
        backgroundColor: 'var(--surface-overlay)',
        color: 'var(--text-primary)'
      })
    })
  })

  it('hideTooltip 时不渲染 Tooltip', async () => {
    render(<IconButton icon={icon} label="无提示" hideTooltip />)
    await userEvent.hover(screen.getByRole('button', { name: '无提示' }))
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('IconButton - 状态语义', () => {
  it('active 时同时设置 aria-pressed 与背景态', () => {
    render(<IconButton icon={icon} label="已开启" active />)
    const button = screen.getByRole('button', { name: '已开启' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveClass('bg-bg-active')
  })

  it('非 active 时不设置 aria-pressed', () => {
    render(<IconButton icon={icon} label="未开启" />)
    expect(screen.getByRole('button', { name: '未开启' })).not.toHaveAttribute('aria-pressed')
  })

  it('aria-expanded 可显式控制（用于折叠面板）', () => {
    render(<IconButton icon={icon} label="展开" aria-expanded={false} />)
    expect(screen.getByRole('button', { name: '展开' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('danger 使用错误色而不是仅靠红字', () => {
    render(<IconButton icon={icon} label="删除会话" danger />)
    expect(screen.getByRole('button', { name: '删除会话' })).toHaveClass('hover:text-err')
  })

  it('disabled 时不可点击', async () => {
    const onClick = vi.fn()
    render(<IconButton icon={icon} label="禁用" disabled onClick={onClick} />)
    const button = screen.getByRole('button', { name: '禁用' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('点击回调收到一次事件', async () => {
    const onClick = vi.fn()
    render(<IconButton icon={icon} label="点击" onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: '点击' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('IconButton - 尺寸与键盘', () => {
  it('md 与 sm 使用不同的点击区域', () => {
    const { unmount } = render(<IconButton icon={icon} label="中" />)
    expect(screen.getByRole('button', { name: '中' })).toHaveClass('h-8', 'w-8')
    unmount()

    render(<IconButton icon={icon} label="小" size="sm" />)
    expect(screen.getByRole('button', { name: '小' })).toHaveClass('h-7', 'w-7')
  })

  it('键盘 Tab 可聚焦并触发点击', async () => {
    const onClick = vi.fn()
    render(<IconButton icon={icon} label="键盘" onClick={onClick} />)

    await userEvent.tab()
    const button = screen.getByRole('button', { name: '键盘' })
    expect(button).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('autoFocus 让弹层关闭按钮在挂载后立即获得焦点', () => {
    render(<IconButton icon={icon} label="关闭插件详情" autoFocus />)
    expect(screen.getByRole('button', { name: '关闭插件详情' })).toHaveFocus()
  })
})
