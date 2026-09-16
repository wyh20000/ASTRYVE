/**
 * @vitest-environment jsdom
 *
 * 主题模式卡片（对齐 Codex 的外观选择器）。
 *
 * 视觉约定（由用户逐轮确认）：
 * - 卡片**没有外框装饰**：未选中为透明边框（占位、避免抖动），选中为强调色边框；
 * - 三张卡片直接落在页面上，外面不再包一层带边框的容器；
 * - 不显示「当前实际生效」文案，选中状态由 aria-checked + 对勾表达。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeModeCards } from './ThemeModeCards'

function previewImage(card: HTMLElement): HTMLImageElement | null {
  return card.querySelector('img')
}

describe('ThemeModeCards - 语义与交互', () => {
  it('渲染三个模式，使用 radiogroup + radio 语义', () => {
    render(<ThemeModeCards value="dark" onChange={() => undefined} systemDark={false} />)
    expect(screen.getByRole('radiogroup', { name: '主题模式' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: '主题模式：跟随系统' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '主题模式：浅色' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '主题模式：深色' })).toBeInTheDocument()
  })

  it('当前模式标记为 aria-checked', () => {
    render(<ThemeModeCards value="light" onChange={() => undefined} systemDark={false} />)
    expect(screen.getByRole('radio', { name: '主题模式：浅色' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: '主题模式：深色' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('点击卡片回调收到对应模式', async () => {
    const onChange = vi.fn()
    render(<ThemeModeCards value="dark" onChange={onChange} systemDark={false} />)
    await userEvent.click(screen.getByRole('radio', { name: '主题模式：跟随系统' }))
    expect(onChange).toHaveBeenCalledWith('system')
  })

  it('键盘可达（Tab 聚焦 + Enter 选择）', async () => {
    const onChange = vi.fn()
    render(<ThemeModeCards value="dark" onChange={onChange} systemDark={false} />)
    await userEvent.tab()
    expect(screen.getByRole('radio', { name: '主题模式：跟随系统' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('system')
  })

  it('disabled 时不可选择', async () => {
    const onChange = vi.fn()
    render(<ThemeModeCards value="dark" onChange={onChange} systemDark={false} disabled />)
    await userEvent.click(screen.getByRole('radio', { name: '主题模式：浅色' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})

/** 取缩略图外层（可点区域 / 高亮区） */
function previewWrapper(card: HTMLElement): HTMLElement | null {
  return card.querySelector('span.overflow-hidden')
}

describe('ThemeModeCards - 缩略图铺满可点区域', () => {
  it('图片外层不加内边距，图片铺满高亮区', () => {
    render(<ThemeModeCards value="dark" onChange={() => undefined} systemDark={false} />)
    const card = screen.getByRole('radio', { name: '主题模式：深色' })
    const wrap = previewWrapper(card)
    expect(wrap).not.toBeNull()
    // 高亮层不应有内边距，否则图片无法铺满
    expect(wrap!.getAttribute('class')).not.toMatch(/(^|\s)p-/)
    // 图片自身也不再带边框（边框属于高亮层）
    const img = card.querySelector('img')!
    expect(img.getAttribute('class')).not.toContain('border')
  })

  it('选中态用强调色边框表达（在高亮层上）', () => {
    render(<ThemeModeCards value="dark" onChange={() => undefined} systemDark={false} />)
    const card = screen.getByRole('radio', { name: '主题模式：深色' })
    expect(previewWrapper(card)!.getAttribute('class')).toContain('border-accent')
  })

  it('未选中使用透明边框占位，避免切换时尺寸抖动', () => {
    render(<ThemeModeCards value="dark" onChange={() => undefined} systemDark={false} />)
    const card = screen.getByRole('radio', { name: '主题模式：浅色' })
    const cls = previewWrapper(card)!.getAttribute('class') ?? ''
    expect(cls).toContain('border-transparent')
    expect(cls).not.toContain('border-accent')
  })

  it('文字位于高亮区之外（hover 不会把标签一起染色）', () => {
    render(<ThemeModeCards value="dark" onChange={() => undefined} systemDark={false} />)
    const card = screen.getByRole('radio', { name: '主题模式：深色' })
    const wrap = previewWrapper(card)!
    // 高亮层里只有图片，标签不在其中
    expect(wrap.querySelector('img')).not.toBeNull()
    expect(wrap.textContent?.trim() ?? '').toBe('')
    expect(card.textContent).toContain('深色')
  })
})

describe('ThemeModeCards - 不展示「当前」文案', () => {
  it('不再把当前实际生效的明暗写进卡片', () => {
    const { unmount } = render(
      <ThemeModeCards value="system" onChange={() => undefined} systemDark />
    )
    expect(screen.queryByText(/当前/)).not.toBeInTheDocument()
    unmount()

    render(<ThemeModeCards value="system" onChange={() => undefined} systemDark={false} />)
    expect(screen.queryByText(/当前/)).not.toBeInTheDocument()
  })

  it('systemDark 仍作为公开契约被接受（不报错、不影响渲染）', () => {
    const { container } = render(
      <ThemeModeCards value="system" onChange={() => undefined} systemDark />
    )
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3)
  })
})

describe('ThemeModeCards - 缩略图资源', () => {
  it('每个模式使用不同的缩略图', () => {
    render(<ThemeModeCards value="dark" onChange={() => undefined} systemDark={false} />)
    const srcs = (['跟随系统', '浅色', '深色'] as const).map((label) => {
      const card = screen.getByRole('radio', { name: `主题模式：${label}` })
      return previewImage(card)?.getAttribute('src') ?? ''
    })
    expect(srcs.every(Boolean)).toBe(true)
    expect(new Set(srcs).size).toBe(3)
  })

  it('缩略图是装饰性的（alt 为空），名称由按钮提供', () => {
    render(<ThemeModeCards value="dark" onChange={() => undefined} systemDark={false} />)
    const card = screen.getByRole('radio', { name: '主题模式：深色' })
    const img = previewImage(card)
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('aria-hidden', 'true')
  })
})
