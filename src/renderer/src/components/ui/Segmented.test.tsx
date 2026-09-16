/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './Segmented'

const MODES = [
  { value: 'system' as const, label: '跟随系统' },
  { value: 'light' as const, label: '浅色' },
  { value: 'dark' as const, label: '深色' }
]

describe('SegmentedControl - 基本行为', () => {
  it('渲染全部选项并标记当前选中项', () => {
    render(<SegmentedControl value="system" onChange={() => undefined} options={MODES} />)
    expect(screen.getByText('跟随系统')).toBeInTheDocument()
    expect(screen.getByText('浅色')).toBeInTheDocument()
    expect(screen.getByText('深色')).toBeInTheDocument()

    // 选中项使用 antd 的 selected 语义类
    const selected = screen.getByText('跟随系统').closest('label')
    expect(selected).toHaveClass('ant-segmented-item-selected')
  })

  it('点击其他选项回调收到该值（收敛为纯值，不是事件）', async () => {
    const onChange = vi.fn()
    render(<SegmentedControl value="system" onChange={onChange} options={MODES} />)

    await userEvent.click(screen.getByText('深色'))
    expect(onChange).toHaveBeenCalledWith('dark')
    // 确认不是把原生事件对象传出去
    expect(typeof onChange.mock.calls[0][0]).toBe('string')
  })

  it('受控更新后选中态跟随', async () => {
    function Harness(): JSX.Element {
      const [mode, setMode] = useState<'system' | 'light' | 'dark'>('system')
      return <SegmentedControl value={mode} onChange={setMode} options={MODES} />
    }
    render(<Harness />)

    await userEvent.click(screen.getByText('浅色'))
    expect(screen.getByText('浅色').closest('label')).toHaveClass('ant-segmented-item-selected')
    expect(screen.getByText('跟随系统').closest('label')).not.toHaveClass(
      'ant-segmented-item-selected'
    )
  })

  it('支持裸值选项，label 取值的字符串形式', () => {
    render(<SegmentedControl value="a" onChange={() => undefined} options={['a', 'b']} />)
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('支持数字值', async () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        value={1}
        onChange={onChange}
        options={[
          { value: 1, label: '一级' },
          { value: 2, label: '二级' }
        ]}
      />
    )
    await userEvent.click(screen.getByText('二级'))
    expect(onChange).toHaveBeenCalledWith(2)
  })
})

describe('SegmentedControl - 状态', () => {
  it('disabled 时不可交互', async () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl value="system" onChange={onChange} options={MODES} disabled />
    )
    await userEvent.click(screen.getByText('深色'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('单项 disabled 时该项不可选，其他项仍可选', async () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        value="system"
        onChange={onChange}
        options={[
          { value: 'system', label: '跟随系统' },
          { value: 'light', label: '浅色', disabled: true },
          { value: 'dark', label: '深色' }
        ]}
      />
    )
    await userEvent.click(screen.getByText('浅色'))
    expect(onChange).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('深色'))
    expect(onChange).toHaveBeenCalledWith('dark')
  })

  it('block 默认开启（设置页里的模式选择占满整行）', () => {
    const { container } = render(
      <SegmentedControl value="system" onChange={() => undefined} options={MODES} />
    )
    expect(container.querySelector('.ant-segmented-block')).not.toBeNull()
  })

  it('block=false 时不占满整行', () => {
    const { container } = render(
      <SegmentedControl value="system" onChange={() => undefined} options={MODES} block={false} />
    )
    expect(container.querySelector('.ant-segmented-block')).toBeNull()
  })

  it('透传 aria-label 供无障碍识别', () => {
    render(
      <SegmentedControl
        value="system"
        onChange={() => undefined}
        options={MODES}
        aria-label="主题模式"
      />
    )
    expect(screen.getByLabelText('主题模式')).toBeInTheDocument()
  })
})
