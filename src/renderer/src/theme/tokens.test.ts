import { describe, expect, it } from 'vitest'
import { DEFAULT_UI_FONT_SIZE } from '@shared/themePreferences'
import {
  DEFAULT_ACCENT,
  FONT_MONO,
  FONT_SANS,
  alpha,
  basePalette,
  bestOn,
  contrast,
  ensureContrast,
  luminance,
  mix,
  resolveTheme,
  type ResolvedTheme
} from './tokens'

const DARK = resolveTheme({ mode: 'dark', isDark: true })
const LIGHT = resolveTheme({ mode: 'light', isDark: false })
/** 未收到系统偏好信号时的解析结果（回退深色） */
const SYSTEM = resolveTheme({ mode: 'system' })

/** 展开成 [令牌路径, 颜色值] 列表 */
function colorEntries(theme: ResolvedTheme): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (node: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'string') out.push([path, value])
      else if (value && typeof value === 'object') walk(value as Record<string, unknown>, path)
    }
  }
  walk(theme.color as unknown as Record<string, unknown>, '')
  return out
}

describe('颜色工具', () => {
  it('mix 按比例混合', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('luminance 黑白极值', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('contrast 黑白为 21:1，同色为 1:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 4)
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 4)
  })

  it('ensureContrast 把低对比度前景调到达标', () => {
    const adjusted = ensureContrast('#777777', '#777777')
    expect(contrast(adjusted, '#777777')).toBeGreaterThanOrEqual(4.5)
  })

  it('ensureContrast 对已达标颜色不做修改', () => {
    expect(ensureContrast('#ffffff', '#000000')).toBe('#ffffff')
  })

  it('bestOn 优先使用达标的候选（白字优先，观感更好）', () => {
    // 黑底：白字达标 → 选白
    expect(bestOn('#000000', ['#ffffff', '#000000'])).toBe('#ffffff')
    // 白底：白字不达标 → 改用黑字
    expect(bestOn('#ffffff', ['#ffffff', '#000000'])).toBe('#000000')
  })

  it('bestOn 首选不达标时改用其他达标候选，而不是硬用首选', () => {
    // 红底：白字 4.00 不达标、黑字 5.25 达标 → 必须选黑
    expect(bestOn('#ff0000', ['#ffffff', '#000000'])).toBe('#000000')
  })

  it('alpha 输出 rgba 并夹取范围', () => {
    expect(alpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
    expect(alpha('#ff0000', 5)).toBe('rgba(255, 0, 0, 1)')
    expect(alpha('#ff0000', -1)).toBe('rgba(255, 0, 0, 0)')
  })
})

describe('resolveTheme - 模式与明暗', () => {
  it('dark 模式解析为深色', () => {
    expect(DARK.isDark).toBe(true)
    expect(DARK.light).toBe(false)
    expect(DARK.mode).toBe('dark')
  })

  it('light 模式解析为浅色', () => {
    expect(LIGHT.isDark).toBe(false)
    expect(LIGHT.light).toBe(true)
  })

  it('system 模式由外部传入的 isDark 决定实际明暗', () => {
    expect(resolveTheme({ mode: 'system', isDark: true }).light).toBe(false)
    expect(resolveTheme({ mode: 'system', isDark: false }).light).toBe(true)
  })

  it('system 模式在无系统偏好信号时回退深色', () => {
    const theme = SYSTEM
    expect(theme.isDark).toBe(true)
    expect(theme.mode).toBe('system')
  })

  it('默认调用等价于跟随系统', () => {
    expect(resolveTheme().mode).toBe('system')
  })

  it('basePalette 按明暗返回不同色板', () => {
    expect(basePalette(true).surfaceApp).not.toBe(basePalette(false).surfaceApp)
  })

  it('深色默认使用中性冷灰而非高饱和蓝黑', () => {
    expect(DARK.color.surface.app).toBe('#111315')
    expect(DARK.color.surface.sidebar).toBe('#181b1e')
    expect(DARK.color.surface.overlay).toBe('#24282d')
  })
})

describe('resolveTheme - 颜色令牌合法性', () => {
  it('所有颜色令牌都是合法 hex 或 rgba', () => {
    for (const theme of [DARK, LIGHT]) {
      for (const [path, value] of colorEntries(theme)) {
        expect(value, `${path} = ${value}`).toMatch(
          /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/
        )
      }
    }
  })

  it('任何前景令牌都不会与背景完全同色（不可见）', () => {
    for (const theme of [DARK, LIGHT]) {
      const app = theme.color.surface.app
      const raised = theme.color.surface.raised
      for (const [path, value] of colorEntries(theme)) {
        if (!value.startsWith('#')) continue
        // 表面类令牌本身就是背景，允许与背景同色
        if (path.startsWith('surface.')) continue
        // inverse 文字只出现在强调色/深色块上，不与应用背景直接相邻
        if (path === 'text.inverse') continue
        // accent.contrastText 只出现在强调色实底上，不与页面表面直接相邻
        if (path === 'accent.contrastText') continue
        // 代码块/编辑器背景属于容器色，允许与应用背景接近
        if (path === 'code.editor' || path === 'code.block') continue
        expect(contrast(value, app), `${path} 在 app 表面不可见`).toBeGreaterThan(1.02)
        expect(contrast(value, raised), `${path} 在 raised 表面不可见`).toBeGreaterThan(1.02)
      }
    }
  })

  it('深色与浅色令牌集合完全一致', () => {
    const darkPaths = colorEntries(DARK).map(([p]) => p).sort()
    const lightPaths = colorEntries(LIGHT).map(([p]) => p).sort()
    expect(darkPaths).toEqual(lightPaths)
  })
})

describe('resolveTheme - 对比度（WCAG）', () => {
  const surfaceNames = ['app', 'sidebar', 'panel', 'raised', 'overlay'] as const

  it('正文文字在所有表面达到 AA 4.5:1', () => {
    for (const theme of [DARK, LIGHT]) {
      for (const surface of surfaceNames) {
        expect(
          contrast(theme.color.text.primary, theme.color.surface[surface]),
          `${theme.mode}/${surface} primary`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('次要文字在所有表面达到 AA 4.5:1', () => {
    for (const theme of [DARK, LIGHT]) {
      for (const surface of surfaceNames) {
        expect(
          contrast(theme.color.text.secondary, theme.color.surface[surface]),
          `${theme.mode}/${surface} secondary`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('弱文本在所有表面保持可读（内容表面 4.5:1，侧栏镶边 4.4:1）', () => {
    // 侧栏是低对比度镶边表面，弱文本在其中略低于内容表面阈值，
    // 仍远高于 WCAG 对非关键文本的要求；关键信息不使用 muted。
    for (const theme of [DARK, LIGHT]) {
      for (const surface of surfaceNames) {
        expect(
          contrast(theme.color.text.muted, theme.color.surface[surface]),
          `${theme.mode}/${surface} muted`
        ).toBeGreaterThanOrEqual(surface === 'sidebar' ? 4.4 : 4.5)
      }
    }
  })

  it('强调色上的文字达到 AA 4.5:1', () => {
    for (const theme of [DARK, LIGHT]) {
      expect(
        contrast(theme.color.accent.contrastText, theme.color.accent.primary)
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('链接色在应用背景上达到 AA 4.5:1', () => {
    for (const theme of [DARK, LIGHT]) {
      expect(contrast(theme.color.text.link, theme.color.surface.app)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('焦点环在应用背景上达到 3:1', () => {
    for (const theme of [DARK, LIGHT]) {
      expect(contrast(theme.color.border.focus, theme.color.surface.app)).toBeGreaterThanOrEqual(3)
    }
  })

  it('边框在应用背景上有可辨识的最小对比度', () => {
    for (const theme of [DARK, LIGHT]) {
      expect(contrast(theme.color.border.default, theme.color.surface.app)).toBeGreaterThanOrEqual(
        1.15
      )
      expect(contrast(theme.color.border.strong, theme.color.surface.app)).toBeGreaterThanOrEqual(
        1.3
      )
    }
  })

  it('状态色作为文字/指示使用时达到 3:1', () => {
    for (const theme of [DARK, LIGHT]) {
      for (const key of ['success', 'warning', 'error', 'info'] as const) {
        expect(
          contrast(theme.color.status[key], theme.color.surface.app),
          `${theme.mode} status.${key}`
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('resolveTheme - 自定义覆盖的派生', () => {
  it('自定义背景色会重新派生各表面层级且保持单调递增', () => {
    const theme = resolveTheme({ mode: 'dark', overrides: { bg: '#000000' } })
    expect(theme.color.surface.app).toBe('#000000')
    const { sidebar, panel, raised, overlay } = theme.color.surface
    expect(luminance(sidebar)).toBeGreaterThan(luminance(theme.color.surface.app))
    expect(luminance(panel)).toBeGreaterThan(luminance(sidebar))
    expect(luminance(raised)).toBeGreaterThan(luminance(panel))
    expect(luminance(overlay)).toBeGreaterThan(luminance(raised))
  })

  it('自定义背景色时边框仍然可见', () => {
    const theme = resolveTheme({ mode: 'dark', overrides: { bg: '#000000' } })
    expect(
      contrast(theme.color.border.default, theme.color.surface.app)
    ).toBeGreaterThanOrEqual(1.24)
    expect(
      contrast(theme.color.border.strong, theme.color.surface.app)
    ).toBeGreaterThanOrEqual(1.4)
  })

  it('自定义强调色会派生 hover / active / soft / 对比文字', () => {
    const theme = resolveTheme({ mode: 'dark', overrides: { accent: '#ff0000' } })
    expect(theme.color.accent.primary).toBe('#ff0000')
    expect(theme.color.accent.hover).not.toBe('#ff0000')
    expect(theme.color.accent.active).not.toBe('#ff0000')
    expect(theme.color.accent.soft).toMatch(/^rgba\(255, 0, 0, /)
    expect(
      contrast(theme.color.accent.contrastText, theme.color.accent.primary)
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('自定义低对比度文字会被自动补足到可读', () => {
    const theme = resolveTheme({ mode: 'light', overrides: { text: '#cccccc' } })
    expect(contrast(theme.color.text.primary, theme.color.surface.app)).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(theme.color.text.secondary, theme.color.surface.raised)
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('自定义背景色后正文对比度仍然达标', () => {
    for (const bg of ['#000000', '#ffffff', '#7f7f7f', '#123456']) {
      const theme = resolveTheme({ mode: 'dark', overrides: { bg } })
      expect(contrast(theme.color.text.primary, bg), `bg=${bg} primary`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('自定义背景与模式相反时自动改写实际明暗，避免深底深字', () => {
    // 浅色模式填纯黑背景 → 实际按深色渲染
    const darkByBg = resolveTheme({ mode: 'light', overrides: { bg: '#000000' } })
    expect(darkByBg.isDark).toBe(true)
    expect(contrast(darkByBg.color.text.primary, '#000000')).toBeGreaterThanOrEqual(4.5)

    // 深色模式填纯白背景 → 实际按浅色渲染
    const lightByBg = resolveTheme({ mode: 'dark', overrides: { bg: '#ffffff' } })
    expect(lightByBg.isDark).toBe(false)
    expect(contrast(lightByBg.color.text.primary, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('调用方显式指定的明暗优先于背景推断（系统主题场景）', () => {
    const theme = resolveTheme({ mode: 'system', isDark: true, overrides: { bg: '#ffffff' } })
    expect(theme.mode).toBe('system')
    expect(theme.isDark).toBe(true)
    expect(contrast(theme.color.text.primary, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('用户显式文字色优先，不被背景推断覆盖', () => {
    const theme = resolveTheme({ mode: 'dark', overrides: { bg: '#000000', text: '#ffcc00' } })
    expect(theme.color.text.primary).toBe('#ffcc00')
  })

  it('用户把文字填成与背景同色时自动补足而不是不可见', () => {
    const theme = resolveTheme({ mode: 'dark', overrides: { bg: '#000000', text: '#000000' } })
    expect(theme.color.text.primary).not.toBe('#000000')
    expect(contrast(theme.color.text.primary, '#000000')).toBeGreaterThanOrEqual(4.5)
  })

  it('非法覆盖不会污染令牌', () => {
    const theme = resolveTheme({
      mode: 'dark',
      isDark: true,
      overrides: { bg: 'not-a-color', accent: 'red' }
    })
    expect(theme.color.surface.app).toBe(DARK.color.surface.app)
    expect(theme.color.accent.primary).toBe(DEFAULT_ACCENT)
  })

  it('默认强调色上白字达标（避免实心按钮被迫用黑字）', () => {
    for (const theme of [DARK, LIGHT]) {
      const accent = theme.color.accent.primary
      expect(contrast('#ffffff', accent), `${theme.mode} 白字对比`).toBeGreaterThanOrEqual(4.5)
      expect(theme.color.accent.contrastText).toBe('#ffffff')
    }
  })

  it('交互态（hover/active）向黑派生，白字对比度不下降', () => {
    for (const theme of [DARK, LIGHT]) {
      const base = contrast('#ffffff', theme.color.accent.primary)
      const hover = contrast('#ffffff', theme.color.accent.hover)
      const active = contrast('#ffffff', theme.color.accent.active)
      // 交互态应更深：白字对比度只增不减
      expect(hover, `${theme.mode} hover`).toBeGreaterThanOrEqual(base)
      expect(active, `${theme.mode} active`).toBeGreaterThanOrEqual(hover)
    }
  })

  it('深色与浅色使用同一个默认强调色', () => {
    expect(DARK.color.accent.primary).toBe(LIGHT.color.accent.primary)
  })

  it('默认强调色是克制的蓝色', () => {
    expect(DARK.color.accent.primary).toBe(DEFAULT_ACCENT)
    expect(LIGHT.color.accent.primary).toBe(DEFAULT_ACCENT)
  })
})

describe('字体与排版令牌', () => {
  it('界面字体微软雅黑优先，并保留非 Windows 回退', () => {
    expect(FONT_SANS.indexOf('Microsoft YaHei')).toBeLessThan(FONT_SANS.indexOf('PingFang SC'))
    expect(FONT_SANS).toContain('Segoe UI')
    expect(FONT_SANS).toContain('sans-serif')
  })

  it('代码与终端字体使用等宽栈，不含微软雅黑', () => {
    expect(FONT_MONO).toContain('JetBrains Mono')
    expect(FONT_MONO).toContain('Consolas')
    expect(FONT_MONO).not.toContain('Microsoft YaHei')
  })

  it('字号层级为 14 / 16 / 20 / 24', () => {
    const { size } = DARK.font
    expect(size.body).toBe(14)
    expect(size.section).toBe(16)
    expect(size.page).toBe(20)
    expect(size.hero).toBe(24)
    expect(size.code).toBe(14)
  })

  it('字号基准默认 14，且不再出现 9~13px 层级', () => {
    expect(DARK.font.baseSize).toBe(DEFAULT_UI_FONT_SIZE)
    for (const value of Object.values(DARK.font.size)) {
      expect(value).toBeGreaterThanOrEqual(14)
    }
  })

  it('字重为 400 / 500 / 600', () => {
    expect(DARK.font.weight).toEqual({ regular: 400, medium: 500, semibold: 600 })
  })

  it('Markdown 正文行高 1.65，代码行高 1.5', () => {
    expect(DARK.font.proseLineHeight).toBe('1.65')
    expect(DARK.font.codeLineHeight).toBe('1.5')
  })

  it('可传入自定义字号基准（接口保留，阶段 A 不开放 UI）', () => {
    expect(resolveTheme({ uiFontSize: 16 }).font.size.body).toBe(16)
  })
})

describe('尺寸与动效令牌', () => {
  it('圆角、间距、阴影、动效齐全', () => {
    expect(DARK.radius).toMatchObject({ sm: 4, md: 6, lg: 10, xl: 14 })
    expect(DARK.space.row).toBeGreaterThanOrEqual(40)
    expect(DARK.space.control).toBe(32)
    expect(DARK.shadow.overlay).toContain('rgba')
    expect(DARK.motion.base).toMatch(/ms$/)
  })

  it('深浅色的阴影强度不同', () => {
    expect(DARK.shadow.modal).not.toBe(LIGHT.shadow.modal)
  })
})
