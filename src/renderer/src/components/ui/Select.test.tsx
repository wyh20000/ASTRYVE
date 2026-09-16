/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SelectControl } from './Select'

/**
 * 注意（antd 6 与 5 的 DOM 差异，已记入 docs/13-组件API参考.md）：
 * antd 6 不再使用 `.ant-select-selector`，改名为 `.ant-select-content`。
 * 因此这里统一通过 role="combobox" 定位触发器，不依赖内部类名。
 */
const OPTIONS = [
  { value: 'gpt', label: 'GPT-4o' },
  { value: 'claude', label: 'Claude 3.7' },
  { value: 'deepseek', label: 'DeepSeek V3', disabled: true }
]

/** 打开下拉并返回选项元素 */
async function openDropdown(): Promise<HTMLElement[]> {
  await userEvent.click(screen.getByRole('combobox'))
  await screen.findByRole('listbox')
  return screen.getAllByRole('option') as HTMLElement[]
}

describe('SelectControl - 基本行为', () => {
  it('渲染当前选中项的文案', () => {
    render(<SelectControl value="gpt" onChange={() => undefined} options={OPTIONS} />)
    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
  })

  it('无值时显示 placeholder', () => {
    render(
      <SelectControl
        value={undefined}
        onChange={() => undefined}
        options={OPTIONS}
        placeholder="选择模型"
      />
    )
    expect(screen.getByText('选择模型')).toBeInTheDocument()
  })

  it('展开后列出全部选项，选择时回调纯值', async () => {
    const onChange = vi.fn()
    render(<SelectControl value="gpt" onChange={onChange} options={OPTIONS} />)

    await openDropdown()
    /*
     * 不用 getAllByRole("option") 统计数量：实测 antd 6 只为「可选」项加
     * role="option"，被禁用的项没有该 role，只带 aria-disabled="true"。
     * 因此这里按渲染结构断言，三个选项都应出现。
     */
    const items = document.querySelectorAll('.ant-select-item-option')
    expect(items).toHaveLength(3)

    await userEvent.click(screen.getByText('Claude 3.7'))
    expect(onChange).toHaveBeenCalledWith('claude')
    // 确认传出去的是纯值而不是原生事件
    expect(typeof onChange.mock.calls.at(-1)?.[0]).toBe('string')
  })

  it('disabled 选项带禁止选中语义且点击无效', async () => {
    const onChange = vi.fn()
    render(<SelectControl value="gpt" onChange={onChange} options={OPTIONS} />)

    await openDropdown()
    const disabledOption = screen.getByText('DeepSeek V3').closest('.ant-select-item')
    expect(disabledOption).toHaveClass('ant-select-item-option-disabled')
    // 禁用项通过 aria-disabled 暴露状态（但没有 role="option"）
    expect(disabledOption).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(screen.getByText('DeepSeek V3'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('整体禁用时不可展开', async () => {
    const { container } = render(
      <SelectControl value="gpt" onChange={() => undefined} options={OPTIONS} disabled />
    )
    expect(container.querySelector('.ant-select-disabled')).not.toBeNull()

    await userEvent.click(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('SelectControl - 配置', () => {
  it('block 时占满容器宽度', () => {
    const { container } = render(
      <SelectControl value="gpt" onChange={() => undefined} options={OPTIONS} block />
    )
    const select = container.querySelector('.ant-select') as HTMLElement
    expect(select.style.width).toBe('100%')
  })

  it('默认不允许清空（模型这类必选项不应为空）', () => {
    const { container } = render(
      <SelectControl value="gpt" onChange={() => undefined} options={OPTIONS} />
    )
    expect(container.querySelector('.ant-select-clear')).toBeNull()
  })

  it('allowClear 时显示清空按钮', async () => {
    const { container } = render(
      <SelectControl value="gpt" onChange={() => undefined} options={OPTIONS} allowClear />
    )
    await userEvent.hover(container.querySelector('.ant-select') as Element)
    expect(container.querySelector('.ant-select-clear')).not.toBeNull()
  })

  it('错误态使用 antd 语义类', () => {
    const { container } = render(
      <SelectControl value="gpt" onChange={() => undefined} options={OPTIONS} status="error" />
    )
    expect(container.querySelector('.ant-select-status-error')).not.toBeNull()
  })

  it('透传 aria-label', () => {
    render(
      <SelectControl value="gpt" onChange={() => undefined} options={OPTIONS} aria-label="模型" />
    )
    expect(screen.getByLabelText('模型')).toBeInTheDocument()
  })

  it('数字值同样收敛为纯值', async () => {
    const onChange = vi.fn()
    render(
      <SelectControl
        value={1}
        onChange={onChange}
        options={[
          { value: 1, label: '一级' },
          { value: 2, label: '二级' }
        ]}
      />
    )
    await openDropdown()
    await userEvent.click(screen.getByText('二级'))
    expect(onChange).toHaveBeenCalledWith(2)
  })
})
