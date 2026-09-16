/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TagChip, ToggleSwitch } from './Toggle'

describe('ToggleSwitch', () => {
  it('渲染为 switch 角色并反映选中态', () => {
    render(<ToggleSwitch checked onChange={() => undefined} aria-label="启用" />)
    expect(screen.getByRole('switch', { name: '启用' })).toBeChecked()
  })

  it('未选中时 unchecked', () => {
    render(<ToggleSwitch checked={false} onChange={() => undefined} aria-label="启用" />)
    expect(screen.getByRole('switch', { name: '启用' })).not.toBeChecked()
  })

  it('点击回调收敛为布尔值', async () => {
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} aria-label="启用" />)

    await userEvent.click(screen.getByRole('switch', { name: '启用' }))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(typeof onChange.mock.calls[0][0]).toBe('boolean')
  })

  it('disabled 时不可切换', async () => {
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} disabled aria-label="启用" />)

    const sw = screen.getByRole('switch', { name: '启用' })
    expect(sw).toBeDisabled()
    await userEvent.click(sw)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('loading 时不可切换', async () => {
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} loading aria-label="启用" />)

    const sw = screen.getByRole('switch', { name: '启用' })
    expect(sw).toHaveClass('ant-switch-loading')
    await userEvent.click(sw)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('size 只接受 small / default（antd 的 SwitchSize 不含 large）', () => {
    const { container, unmount } = render(
      <ToggleSwitch checked onChange={() => undefined} size="small" aria-label="小" />
    )
    expect(container.querySelector('.ant-switch-small')).not.toBeNull()
    unmount()

    const { container: def } = render(
      <ToggleSwitch checked onChange={() => undefined} size="default" aria-label="默认" />
    )
    expect(def.querySelector('.ant-switch-small')).toBeNull()
  })

  it('键盘 Space 可切换', async () => {
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} aria-label="启用" />)

    await userEvent.tab()
    await userEvent.keyboard(' ')
    expect(onChange).toHaveBeenCalled()
  })
})

describe('TagChip', () => {
  it('渲染文本内容', () => {
    render(<TagChip>已安装</TagChip>)
    expect(screen.getByText('已安装')).toBeInTheDocument()
  })

  it('默认使用 outlined 变体（低噪声）', () => {
    const { container } = render(<TagChip>默认</TagChip>)
    expect(container.querySelector('.ant-tag-outlined')).not.toBeNull()
  })

  it('支持 filled / solid 变体', () => {
    const { container, unmount } = render(<TagChip variant="filled">填充</TagChip>)
    expect(container.querySelector('.ant-tag-filled')).not.toBeNull()
    unmount()

    const { container: solid } = render(<TagChip variant="solid">实心</TagChip>)
    expect(solid.querySelector('.ant-tag-solid')).not.toBeNull()
  })

  it('语义色调映射到 antd 预设色名（调用方不写 hex）', () => {
    const { container } = render(<TagChip tone="success">成功</TagChip>)
    expect(container.querySelector('.ant-tag-success')).not.toBeNull()
  })

  it('error 与 warning 色调各自映射', () => {
    const { container, unmount } = render(<TagChip tone="error">错误</TagChip>)
    expect(container.querySelector('.ant-tag-error')).not.toBeNull()
    unmount()

    const { container: warn } = render(<TagChip tone="warning">警告</TagChip>)
    expect(warn.querySelector('.ant-tag-warning')).not.toBeNull()
  })

  it('neutral 不带预设色类', () => {
    const { container } = render(<TagChip tone="neutral">中性</TagChip>)
    const tag = container.querySelector('.ant-tag') as HTMLElement
    expect(tag.className).not.toMatch(/ant-tag-(success|error|warning|processing|blue)/)
  })

  it('提供 onClose 时显示关闭按钮并可触发', async () => {
    const onClose = vi.fn()
    const { container } = render(<TagChip onClose={onClose}>可关闭</TagChip>)

    const close = container.querySelector('.ant-tag-close-icon')
    expect(close).not.toBeNull()

    await userEvent.click(close as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('不提供 onClose 时没有关闭按钮', () => {
    const { container } = render(<TagChip>不可关闭</TagChip>)
    expect(container.querySelector('.ant-tag-close-icon')).toBeNull()
  })
})
