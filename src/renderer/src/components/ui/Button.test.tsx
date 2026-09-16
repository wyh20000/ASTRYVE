/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button - 语义类型', () => {
  it('默认渲染为 default 且不触发表单提交', () => {
    render(<Button>保存</Button>)
    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toBeInTheDocument()
    // 默认 htmlType="button"，避免在表单里误提交
    expect(button).toHaveAttribute('type', 'button')
  })

  it('primary 使用主色语义', () => {
    render(<Button variant="primary">发送</Button>)
    expect(screen.getByRole('button', { name: '发送' })).toHaveClass('ant-btn-primary')
  })

  it('danger 使用独立危险语义（不只是红色文字）', () => {
    render(<Button variant="danger">删除</Button>)
    const button = screen.getByRole('button', { name: '删除' })
    expect(button).toHaveClass('ant-btn-dangerous')
  })

  it('text 使用无边框文字按钮语义', () => {
    render(<Button variant="text">更多</Button>)
    expect(screen.getByRole('button', { name: '更多' })).toHaveClass('ant-btn-text')
  })

  it('支持显式 htmlType 提交', () => {
    render(<Button htmlType="submit">提交</Button>)
    expect(screen.getByRole('button', { name: '提交' })).toHaveAttribute('type', 'submit')
  })
})

describe('Button - 状态', () => {
  it('disabled 时不可点击且不触发 onClick', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        保存
      </Button>
    )
    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toBeDisabled()

    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('loading 时禁用交互并暴露忙碌状态', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        保存
      </Button>
    )
    const button = screen.getByRole('button', { name: /保存/ })
    expect(button).toHaveClass('ant-btn-loading')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('正常态点击回调收到一次事件', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>保存</Button>)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Button - 键盘可访问性', () => {
  it('Enter 触发点击', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>确定</Button>)
    const button = screen.getByRole('button', { name: '确定' })
    button.focus()
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('Space 触发点击', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>确定</Button>)
    const button = screen.getByRole('button', { name: '确定' })
    button.focus()
    await userEvent.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('Tab 可以聚焦到按钮（不依赖鼠标）', async () => {
    render(<Button>第一个</Button>)
    await userEvent.tab()
    expect(screen.getByRole('button', { name: '第一个' })).toHaveFocus()
  })
})

describe('Button - 图标与布局', () => {
  it('icon 与文本同时渲染', () => {
    render(<Button icon={<span data-testid="leading-icon" />}>新建</Button>)
    expect(screen.getByTestId('leading-icon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建/ })).toBeInTheDocument()
  })

  it('suffix 渲染在文本之后', () => {
    render(<Button suffix={<span data-testid="trailing">▾</span>}>展开</Button>)
    expect(screen.getByTestId('trailing')).toBeInTheDocument()
  })

  it('block 占满整行', () => {
    render(<Button block>全宽</Button>)
    expect(screen.getByRole('button', { name: '全宽' })).toHaveClass('ant-btn-block')
  })

  it('size=sm 使用小尺寸控件高度', () => {
    render(<Button size="sm">小</Button>)
    expect(screen.getByRole('button', { name: '小' })).toHaveClass('ant-btn-sm')
  })

  it('透传 aria-label 供无文字按钮使用', () => {
    render(<Button aria-label="关闭面板" icon={<span />} />)
    expect(screen.getByRole('button', { name: '关闭面板' })).toBeInTheDocument()
  })

  it('title 可用于轻量提示', () => {
    render(<Button title="提示文本">按钮</Button>)
    expect(screen.getByRole('button', { name: '按钮' })).toHaveAttribute('title', '提示文本')
  })
})
