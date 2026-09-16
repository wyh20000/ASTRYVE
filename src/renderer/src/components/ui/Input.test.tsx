/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchInput, TextArea, TextInput } from './Input'

describe('TextInput', () => {
  it('渲染单行输入框并支持输入', async () => {
    render(<TextInput aria-label="用户名" defaultValue="" />)
    const input = screen.getByLabelText('用户名')
    await userEvent.type(input, 'hello')
    expect(input).toHaveValue('hello')
  })

  it('onChange 透传原生事件（迁移时不必改调用方逻辑）', async () => {
    const onChange = vi.fn()
    render(<TextInput aria-label="字段" onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('字段'), 'a')
    expect(onChange).toHaveBeenCalled()
    // 原生事件对象仍可通过 target.value 读取
    expect(onChange.mock.calls[0][0].target.value).toBe('a')
  })

  it('disabled 时不可输入', () => {
    render(<TextInput aria-label="禁用" disabled />)
    expect(screen.getByLabelText('禁用')).toBeDisabled()
  })

  it('错误态透传 status 供语义与配色使用', () => {
    render(<TextInput aria-label="出错" status="error" />)
    const input = screen.getByLabelText('出错')
    expect(input.closest('.ant-input-status-error')).not.toBeNull()
  })

  it('placeholder 正常展示', () => {
    render(<TextInput aria-label="占位" placeholder="请输入内容" />)
    expect(screen.getByPlaceholderText('请输入内容')).toBeInTheDocument()
  })
})

describe('TextArea', () => {
  it('默认至少 3 行', () => {
    render(<TextArea aria-label="描述" />)
    expect(screen.getByLabelText('描述')).toHaveAttribute('rows', '3')
  })

  it('可显式指定 minRows', () => {
    render(<TextArea aria-label="长描述" minRows={5} />)
    expect(screen.getByLabelText('长描述')).toHaveAttribute('rows', '5')
  })

  it('支持多行输入', async () => {
    render(<TextArea aria-label="正文" />)
    const area = screen.getByLabelText('正文')
    await userEvent.type(area, '第一行{enter}第二行')
    expect(area).toHaveValue('第一行\n第二行')
  })
})

describe('SearchInput', () => {
  it('onChange 收敛为字符串，调用方无需处理事件对象', async () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} aria-label="搜索" />)
    await userEvent.type(screen.getByLabelText('搜索'), 'a')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('受控值由外部驱动', () => {
    render(<SearchInput value="已输入" onChange={() => undefined} aria-label="受控搜索" />)
    expect(screen.getByLabelText('受控搜索')).toHaveValue('已输入')
  })

  it('默认显示清空按钮', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <SearchInput value="关键词" onChange={onChange} aria-label="可清空" />
    )
    const clear = container.querySelector('.ant-input-clear-icon')
    expect(clear).not.toBeNull()

    await userEvent.click(clear as Element)
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('allowClear=false 时不显示清空按钮', () => {
    const { container } = render(
      <SearchInput value="关键词" onChange={() => undefined} allowClear={false} aria-label="不可清空" />
    )
    expect(container.querySelector('.ant-input-clear-icon')).toBeNull()
  })

  it('placeholder 可配置', () => {
    render(<SearchInput value="" onChange={() => undefined} placeholder="搜索会话..." />)
    expect(screen.getByPlaceholderText('搜索会话...')).toBeInTheDocument()
  })
})
