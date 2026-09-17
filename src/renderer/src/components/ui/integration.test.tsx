/**
 * @vitest-environment jsdom
 *
 * 集成验证：全局组件在「真实 Provider 配置」下工作。
 *
 * 与各组件自身单测的区别：
 * - 组件单测运行在 antd 默认主题下，验证的是组件语义与交互；
 * - 这里用与 App.tsx 完全相同的 toAntdTheme(令牌) 包裹，
 *   验证令牌真的能驱动到组件外观上，且自定义强调色会即时生效。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp, ConfigProvider } from 'antd'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toAntdTheme } from '../../theme/applyTheme'
import { resolveTheme, type ResolvedTheme } from '../../theme/tokens'
import { Button } from './Button'
import { FormSection, SettingRow } from './FormSection'
import { IconButton } from './IconButton'
import { SearchInput, TextInput } from './Input'

/** 与 App.tsx 相同的 Provider 结构 */
function WithTheme({
  children,
  theme
}: {
  children: ReactNode
  theme: ResolvedTheme
}): JSX.Element {
  return (
    <ConfigProvider theme={toAntdTheme(theme) as never}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  )
}

let dark: ResolvedTheme
let light: ResolvedTheme

beforeEach(() => {
  dark = resolveTheme({ mode: 'dark', isDark: true })
  light = resolveTheme({ mode: 'light', isDark: false })
})

describe('令牌驱动组件外观', () => {
  it('深色与浅色主题下组件都能正常渲染', () => {
    const { unmount } = render(
      <WithTheme theme={dark}>
        <Button variant="primary">主操作</Button>
      </WithTheme>
    )
    expect(screen.getByRole('button', { name: '主操作' })).toBeInTheDocument()
    unmount()

    render(
      <WithTheme theme={light}>
        <Button variant="primary">主操作</Button>
      </WithTheme>
    )
    expect(screen.getByRole('button', { name: '主操作' })).toBeInTheDocument()
  })

  it('自定义强调色会注入到 Ant Design 主色令牌', () => {
    const custom = resolveTheme({ mode: 'dark', overrides: { accent: '#ff0000' } })
    const config = toAntdTheme(custom) as { token: { colorPrimary: string } }
    expect(config.token.colorPrimary).toBe('#ff0000')
    expect(config.token.colorPrimary).toBe(custom.color.accent.primary)
  })

  it('控件高度与圆角来自令牌而非硬编码', () => {
    const config = toAntdTheme(dark) as {
      token: { controlHeight: number; borderRadius: number; fontSize: number }
    }
    expect(config.token.controlHeight).toBe(dark.space.control)
    expect(config.token.borderRadius).toBe(dark.radius.md)
    expect(config.token.fontSize).toBe(14)
  })
})

describe('组件在 Provider 下的交互', () => {
  it('Button 点击、IconButton aria、TextInput 输入都正常工作', async () => {
    const onPrimary = vi.fn()
    const onIcon = vi.fn()
    render(
      <WithTheme theme={dark}>
        <Button variant="primary" onClick={onPrimary}>
          发送
        </Button>
        <IconButton icon={<svg />} label="新建对话" onClick={onIcon} />
        <TextInput aria-label="会话名" />
      </WithTheme>
    )

    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onPrimary).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: '新建对话' }))
    expect(onIcon).toHaveBeenCalledTimes(1)

    await userEvent.type(screen.getByLabelText('会话名'), 'abc')
    expect(screen.getByLabelText('会话名')).toHaveValue('abc')
  })

  it('受控 SearchInput 在 Provider 下可正常受控更新', async () => {
    function Harness(): JSX.Element {
      const [query, setQuery] = useState('')
      return <SearchInput value={query} onChange={setQuery} aria-label="搜索" />
    }
    render(
      <WithTheme theme={dark}>
        <Harness />
      </WithTheme>
    )

    const input = screen.getByLabelText('搜索')
    await userEvent.type(input, '会话')
    expect(input).toHaveValue('会话')
  })

  it('设置页三件套在 Provider 下组合渲染', () => {
    render(
      <WithTheme theme={dark}>
        <FormSection title="外观" description="选择浅色或深色">
          <SettingRow label="跟随系统" first>
            <Button size="sm">切换</Button>
          </SettingRow>
          <SettingRow label="强调色" description="用于按钮与选中态">
            <TextInput aria-label="强调色" />
          </SettingRow>
        </FormSection>
      </WithTheme>
    )

    expect(screen.getByRole('heading', { name: '外观' })).toBeInTheDocument()
    expect(screen.getByText('选择浅色或深色')).toBeInTheDocument()
    expect(screen.getByText('跟随系统')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '切换' })).toBeInTheDocument()
    expect(screen.getByLabelText('强调色')).toBeInTheDocument()
  })
})

describe('中文排版约束', () => {
  it('按钮文案不插入额外空格（关闭 autoInsertSpace）', () => {
    render(
      <WithTheme theme={dark}>
        <Button>保存</Button>
      </WithTheme>
    )
    // 可访问名称必须是「保存」而不是「保 存」
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' }).textContent).toBe('保存')
  })
})
