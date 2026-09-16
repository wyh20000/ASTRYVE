/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState, SkeletonLines } from './EmptyState'

describe('EmptyState', () => {
  it('渲染主文案', () => {
    render(<EmptyState title="暂无会话" />)
    expect(screen.getByText('暂无会话')).toBeInTheDocument()
  })

  it('主文案使用 16px 分区层级，不是 13px 以下', () => {
    render(<EmptyState title="暂无会话" />)
    expect(screen.getByText('暂无会话')).toHaveClass('text-[16px]')
  })

  it('说明文字为 14px 弱化色，不承载关键信息', () => {
    render(<EmptyState title="暂无会话" description="创建对话后会显示在这里" />)
    const desc = screen.getByText('创建对话后会显示在这里')
    expect(desc).toHaveClass('text-[14px]')
    expect(desc).toHaveClass('text-txt-muted')
  })

  it('没有说明时不渲染说明节点', () => {
    const { container } = render(<EmptyState title="仅标题" />)
    expect(container.textContent).toBe('仅标题')
  })

  it('提供 icon 时渲染图标区', () => {
    render(<EmptyState title="空" icon={<svg data-testid="glyph" />} />)
    expect(screen.getByTestId('glyph')).toBeInTheDocument()
  })

  it('不提供 icon 时不渲染图标容器', () => {
    const { container } = render(<EmptyState title="空" />)
    expect(container.querySelector('.rounded-full')).toBeNull()
  })

  it('渲染建议操作', () => {
    render(
      <EmptyState title="空" action={<button type="button">新建对话</button>} />
    )
    expect(screen.getByRole('button', { name: '新建对话' })).toBeInTheDocument()
  })

  it('使用 status 角色便于屏幕阅读器播报', () => {
    render(<EmptyState title="空" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('compact 模式使用更小的内边距与图标（用于侧栏）', () => {
    const { container } = render(<EmptyState title="空" icon={<svg />} compact />)
    expect(container.firstElementChild?.className).toContain('py-6')
    expect(container.querySelector('.h-9.w-9')).not.toBeNull()
  })
})

describe('SkeletonLines', () => {
  it('默认渲染 3 行', () => {
    const { container } = render(<SkeletonLines />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
  })

  it('可指定行数', () => {
    const { container } = render(<SkeletonLines lines={5} />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5)
  })

  it('行数下限为 1（避免传入 0 时出现空容器）', () => {
    const { container } = render(<SkeletonLines lines={0} />)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1)
  })

  it('标记忙碌状态供无障碍识别', () => {
    render(<SkeletonLines aria-label="正在加载会话" />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveAttribute('aria-label', '正在加载会话')
  })

  it('最后一行较短，贴近真实段落', () => {
    const { container } = render(<SkeletonLines lines={3} />)
    const rows = container.querySelectorAll<HTMLElement>('.animate-pulse')
    expect(rows[2].style.width).toBe('60%')
    expect(rows[0].style.width).toBe('100%')
  })
})
