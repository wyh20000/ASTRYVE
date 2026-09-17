/**
 * @vitest-environment jsdom
 *
 * XProvider 接线验证（阶段 C 第一步）。
 *
 * 设计文档 7.1：根节点由**单一主题对象**同时配置 Ant Design 与 Ant Design X，
 * 避免嵌套两个相互漂移的主题源。
 *
 * API 依据（@ant-design/x 2.9.0 本地类型声明，见 docs/13-组件API参考.md）：
 * - `XProviderProps extends Omit<AntdConfigProviderProps, 'theme' | 'locale'>`，
 *   并自行重定义 `theme`（= antd ThemeConfig，且 components 允许合并 X 的组件 token）
 *   与 `locale`（= X 自己的 xLocale 类型，与 antd locale 不是同一类型）；
 * - 实现上内部渲染 antd 的 `ConfigProvider`，其余 props 原样透传。
 *
 * 注意：这里必须用项目自己的 `Button` 而不是 antd 原生 Button ——
 * 原生 Button 会在两个汉字之间插入空格，可访问名称会变成「确 定」。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp } from 'antd'
import { XProvider } from '@ant-design/x'
import zhCN from '@ant-design/x/es/locale/zh_CN'
import { describe, expect, it } from 'vitest'
import { Button } from './ui'
import { toAntdTheme } from '../theme/antdTheme'
import { resolveTheme } from '../theme/tokens'

const DARK = resolveTheme({ mode: 'dark', isDark: true })
const LIGHT = resolveTheme({ mode: 'light', isDark: false })

describe('XProvider 接线', () => {
  it('承载 antd ThemeConfig 并正常渲染子树', () => {
    render(
      <XProvider theme={toAntdTheme(DARK)} locale={zhCN}>
        <Button>确定</Button>
      </XProvider>
    )
    expect(screen.getByRole('button', { name: '确定' })).toBeInTheDocument()
  })

  it('浅色令牌同样可用（单一主题源，不漂移）', () => {
    render(
      <XProvider theme={toAntdTheme(LIGHT)} locale={zhCN}>
        <Button>确定</Button>
      </XProvider>
    )
    expect(screen.getByRole('button', { name: '确定' })).toHaveClass('ant-btn')
  })

  it('内部渲染 antd ConfigProvider，因此 AntdApp 上下文可用', async () => {
    function Probe(): JSX.Element {
      const { message } = AntdApp.useApp()
      return (
        <button type="button" onClick={() => void message.success('已保存')}>
          触发
        </button>
      )
    }
    render(
      <XProvider theme={toAntdTheme(DARK)} locale={zhCN}>
        <AntdApp>
          <Probe />
        </AntdApp>
      </XProvider>
    )

    await userEvent.click(screen.getByRole('button', { name: '触发' }))
    expect(await screen.findByText('已保存')).toBeInTheDocument()
  })

  it('透传 antd 的其余 ConfigProvider 能力（如 componentSize）', () => {
    render(
      <XProvider theme={toAntdTheme(DARK)} locale={zhCN} componentSize="small">
        <Button>小号</Button>
      </XProvider>
    )
    expect(screen.getByRole('button', { name: '小号' })).toHaveClass('ant-btn-sm')
  })
})
