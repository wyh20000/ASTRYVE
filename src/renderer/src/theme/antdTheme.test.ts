/**
 * @vitest-environment jsdom
 *
 * Ant Design 主题映射的契约测试。
 *
 * 这里同时充当「API 用法记录」：
 * 下方每个断言都对应 antd 6.6.2 的实测行为，
 * 结论与依据记录在 docs/13-组件API参考.md。
 */
import { theme as antdTheme } from 'antd'
import { describe, expect, it } from 'vitest'
import { toAntdTheme } from './antdTheme'
import { resolveTheme } from './tokens'

const DARK = resolveTheme({ mode: 'dark', isDark: true })
const LIGHT = resolveTheme({ mode: 'light', isDark: false })

describe('ThemeConfig 结构', () => {
  it('cssVar 是对象而不是布尔值（antd 6 的真实签名）', () => {
    const config = toAntdTheme(DARK, 'dark')
    // 曾经的错误写法是 cssVar: true；antd 6 定义为 { prefix?, key? }
    expect(typeof config.cssVar).toBe('object')
    expect(config.cssVar?.prefix).toBe('ant')
  })

  it('hashed 关闭以减少单版本应用样式体积', () => {
    expect(toAntdTheme(DARK, 'dark').hashed).toBe(false)
  })

  it('只包含 ThemeConfig 的已知键（不塞自定义调试字段）', () => {
    const config = toAntdTheme(DARK, 'dark') as Record<string, unknown>
    expect(config._mode).toBeUndefined()
    expect(Object.keys(config).sort()).toEqual(
      ['components', 'cssVar', 'hashed', 'token'].sort()
    )
  })
})

describe('token 映射到真实设计令牌', () => {
  it('颜色 token 与令牌一一对应', () => {
    const config = toAntdTheme(DARK, 'dark')
    expect(config.token?.colorPrimary).toBe(DARK.color.accent.primary)
    expect(config.token?.colorBgBase).toBe(DARK.color.surface.app)
    expect(config.token?.colorBgContainer).toBe(DARK.color.surface.raised)
    expect(config.token?.colorBgElevated).toBe(DARK.color.surface.overlay)
    expect(config.token?.colorText).toBe(DARK.color.text.primary)
    expect(config.token?.colorTextSecondary).toBe(DARK.color.text.secondary)
    expect(config.token?.colorTextTertiary).toBe(DARK.color.text.muted)
    expect(config.token?.colorBorder).toBe(DARK.color.border.default)
    expect(config.token?.colorBorderSecondary).toBe(DARK.color.border.subtle)
    expect(config.token?.colorLink).toBe(DARK.color.text.link)
    expect(config.token?.colorError).toBe(DARK.color.status.error)
    /*
     * Ant Design X 的 Bubble filled 变体读取 colorFillContent；
     * 必须映射到本项目令牌，否则深色下气泡底几乎不可见。
     */
    expect(config.token?.colorFillContent).toBe(DARK.color.surface.active)
  })

  it('字体与字号 token 使用 14px 基准与微软雅黑栈', () => {
    const config = toAntdTheme(DARK, 'dark')
    expect(config.token?.fontSize).toBe(14)
    expect(config.token?.fontFamily).toContain('Microsoft YaHei')
    expect(config.token?.fontFamilyCode).toContain('JetBrains Mono')
  })

  it('尺寸 token 来自间距与圆角令牌', () => {
    const config = toAntdTheme(DARK, 'dark')
    expect(config.token?.controlHeight).toBe(DARK.space.control)
    expect(config.token?.borderRadius).toBe(DARK.radius.md)
  })

  it('不使用 var() 作为 token 值（antd 需要可计算的真实色值）', () => {
    const config = toAntdTheme(DARK, 'dark')
    for (const value of Object.values(config.token ?? {})) {
      if (typeof value !== 'string') continue
      expect(value).not.toContain('var(')
    }
  })

  it('深色与浅色产出不同的背景与文字 token', () => {
    const dark = toAntdTheme(DARK, 'dark').token
    const light = toAntdTheme(LIGHT, 'light').token
    expect(dark?.colorBgBase).not.toBe(light?.colorBgBase)
    expect(dark?.colorText).not.toBe(light?.colorText)
  })

  it('自定义强调色会传导到 colorPrimary', () => {
    const custom = resolveTheme({ mode: 'dark', overrides: { accent: '#ff0000' } })
    expect(toAntdTheme(custom, 'dark').token?.colorPrimary).toBe('#ff0000')
  })
})

describe('components 级 token', () => {
  it('弹层与卡片背景跟随令牌，避免与自定义背景不一致', () => {
    const config = toAntdTheme(DARK, 'dark')
    expect(config.components?.Modal?.contentBg).toBe(DARK.color.surface.overlay)
    expect(config.components?.Segmented?.itemSelectedBg).toBe(DARK.color.surface.raised)
    // Card 没有 colorBgContainer 组件级 token，卡片背景走全局 alias
    expect(config.components?.Card).toBeUndefined()
    expect(config.components?.Layout?.bodyBg).toBe(DARK.color.surface.app)
    expect(config.components?.Layout?.siderBg).toBe(DARK.color.surface.sidebar)
  })
})

/**
 * 与 antd 官方实现交叉验证。
 *
 * 目的：确认「我们写进 theme 的内容真的被 antd 采纳」，
 * 而不只是存在于我们自己的对象里。
 *
 * 注意：不要断言「未知 token 键会被 antd 丢弃」——
 * 实测 antd 6.6.2 的 getDesignToken 会把未知键原样保留在结果中，
 * 所以字段名写错时 antd 不会报错，这正是必须依赖 TypeScript 校验的原因。
 */
describe('与 antd 官方算法交叉验证', () => {
  it('colorPrimary 覆盖会被 getDesignToken 采纳', () => {
    const computed = antdTheme.getDesignToken({ token: { colorPrimary: '#ff0000' } })
    expect(computed.colorPrimary).toBe('#ff0000')
  })

  it('fontSize 覆盖会被采纳', () => {
    const computed = antdTheme.getDesignToken({ token: { fontSize: 14 } })
    expect(computed.fontSize).toBe(14)
  })

  it('我们传入的 token 值与官方计算结果完全一致（确实生效）', () => {
    const config = toAntdTheme(DARK, 'dark')
    const computed = antdTheme.getDesignToken(config) as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(config.token ?? {})) {
      expect(computed[key], `token ${key} 未生效`).toBe(value)
    }
  })
})
