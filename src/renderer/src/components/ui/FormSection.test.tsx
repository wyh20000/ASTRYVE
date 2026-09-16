/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FormSection, SettingRow } from './FormSection'

describe('FormSection', () => {
  it('渲染分区标题与内容', () => {
    render(
      <FormSection title="主题外观">
        <div>内容</div>
      </FormSection>
    )
    expect(screen.getByRole('heading', { name: '主题外观' })).toBeInTheDocument()
    expect(screen.getByText('内容')).toBeInTheDocument()
  })

  it('标题使用 16px 分区层级，不是页面层级', () => {
    render(<FormSection title="模型设置">内容</FormSection>)
    const heading = screen.getByRole('heading', { name: '模型设置' })
    expect(heading).toHaveClass('text-[16px]')
    expect(heading.tagName).toBe('H2')
  })

  it('说明文字使用弱化颜色，不承载关键信息', () => {
    render(
      <FormSection title="外观" description="选择浅色或深色">
        内容
      </FormSection>
    )
    const description = screen.getByText('选择浅色或深色')
    expect(description).toHaveClass('text-txt-muted')
  })

  it('没有说明时不渲染空段落', () => {
    const { container } = render(<FormSection title="仅标题">内容</FormSection>)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('extra 渲染在标题行右侧', () => {
    render(
      <FormSection title="外观" extra={<button type="button">恢复默认</button>}>
        内容
      </FormSection>
    )
    expect(screen.getByRole('button', { name: '恢复默认' })).toBeInTheDocument()
  })
})

describe('SettingRow', () => {
  it('左侧为名称与说明，右侧为控件', () => {
    render(
      <SettingRow label="强调色" description="用于按钮与选中态">
        <input aria-label="强调色输入" />
      </SettingRow>
    )
    expect(screen.getByText('强调色')).toBeInTheDocument()
    expect(screen.getByText('用于按钮与选中态')).toBeInTheDocument()
    expect(screen.getByLabelText('强调色输入')).toBeInTheDocument()
  })

  it('窄窗口下改为纵向排列（flex-col 起步）', () => {
    const { container } = render(
      <SettingRow label="分组标题">
        <button type="button">切换</button>
      </SettingRow>
    )
    const row = container.firstElementChild as HTMLElement
    expect(row.className).toContain('flex-col')
    // 断点以上恢复横向
    expect(row.className).toContain('sm:flex-row')
  })

  it('非首行显示分隔线，首行不显示', () => {
    const { container: withBorder } = render(
      <SettingRow label="第二项">
        <button type="button">a</button>
      </SettingRow>
    )
    expect((withBorder.firstElementChild as HTMLElement).className).toContain('border-t')

    const { container: first } = render(
      <SettingRow label="第一项" first>
        <button type="button">b</button>
      </SettingRow>
    )
    expect((first.firstElementChild as HTMLElement).className).not.toContain('border-t')
  })

  it('stacked 布局：标签在上、控件在下，且控件占满整行', () => {
    const { container } = render(
      <SettingRow label="名称" layout="stacked">
        <input aria-label="名称输入" />
      </SettingRow>
    )
    const row = container.firstElementChild as HTMLElement
    // 不进入横向布局（inline 才会用 sm:flex-row）
    expect(row.className).not.toContain('sm:flex-row')
    expect(row.className).toContain('flex-col')

    const controls = row.lastElementChild as HTMLElement
    expect(controls.className).toContain('w-full')
  })

  it('inline（默认）仍然是左右布局，窄窗口才转为纵向', () => {
    const { container } = render(
      <SettingRow label="开关">
        <button type="button">切换</button>
      </SettingRow>
    )
    const row = container.firstElementChild as HTMLElement
    expect(row.className).toContain('sm:flex-row')
  })

  it('block 让控件占据更宽区域（用于输入框）', () => {
    const { container } = render(
      <SettingRow label="名称" block>
        <input aria-label="名称输入" />
      </SettingRow>
    )
    const controls = (container.firstElementChild as HTMLElement).lastElementChild as HTMLElement
    expect(controls.className).toContain('w-full')
  })

  it('没有说明时不渲染说明节点', () => {
    const { container } = render(
      <SettingRow label="只有名称">
        <button type="button">x</button>
      </SettingRow>
    )
    // 只有名称一个文本节点
    expect(container.textContent).toBe('只有名称x')
  })
})
