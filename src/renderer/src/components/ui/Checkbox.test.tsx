/**
 * @vitest-environment jsdom
 *
 * `Checkbox` 的存在理由就是保住「点文字也能切换」这条原生能力，
 * 因此这里重点验证 label 文本上的点击，而不仅仅是点方框。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('用 children 作为可访问名称并反映选中态', () => {
    render(<Checkbox checked onChange={() => undefined}>自动安装安全更新</Checkbox>)

    const box = screen.getByRole('checkbox', { name: '自动安装安全更新' })
    expect(box).toBeChecked()
  })

  it('点方框回调收敛为布尔值', async () => {
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange}>自动安装安全更新</Checkbox>)

    await userEvent.click(screen.getByRole('checkbox', { name: '自动安装安全更新' }))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(typeof onChange.mock.calls[0][0]).toBe('boolean')
  })

  it('点标签文字同样触发切换（原生 label 语义）', async () => {
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange}>自动安装安全更新</Checkbox>)

    await userEvent.click(screen.getByText('自动安装安全更新'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('disabled 时不可切换', async () => {
    const onChange = vi.fn()
    render(<Checkbox checked={false} disabled onChange={onChange}>自动安装安全更新</Checkbox>)

    const box = screen.getByRole('checkbox', { name: '自动安装安全更新' })
    expect(box).toBeDisabled()
    // antd 在禁用态给输入框加了 pointer-events: none，userEvent 会直接拒绝点击，
    // 这里放开该检查以便断言「点了也不会回调」
    await userEvent.click(box, { pointerEventsCheck: 0 })
    await userEvent.click(screen.getByText('自动安装安全更新'), { pointerEventsCheck: 0 })
    expect(onChange).not.toHaveBeenCalled()
  })
})
