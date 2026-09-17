/**
 * 语义设计令牌引擎（阶段 A）。
 *
 * 定位：全应用唯一的设计值来源。CSS 变量、Tailwind、Ant Design，
 * 以及后续的 Ant Design X Provider 都从这里的 `ResolvedTheme` 生成。
 *
 * 约束：
 * - 纯函数，不触碰 DOM，可在 node 环境直接单测。
 * - 业务组件只读取语义令牌，不得在页面里散落 HEX、固定阴影或临时字号。
 * - 派生量（悬浮层、选中层、边框、弱文本、焦点环）由算法得到，
 *   用户只需要提供强调色 / 背景色 / 文字色三项覆盖。
 */
import {
  DEFAULT_UI_FONT_SIZE,
  normalizeHexColor,
  sanitizeThemeOverrides,
  type ThemeMode,
  type ThemeOverrides
} from '@shared/themePreferences'
import {
  DEFAULT_ACCENT,
  FIRST_PAINT_BACKGROUND,
  FIRST_PAINT_SYMBOL
} from '@shared/themePaint'
import { systemPrefersDark } from './systemTheme'

export type { ThemeMode, ThemeOverrides }

/** 语义令牌：颜色 + 字体 + 字号 + 圆角 + 间距 + 阴影 + 动效 */
export interface ResolvedTheme {
  mode: ThemeMode
  /** 实际生效的明暗（mode 为 system 时由系统偏好决定） */
  isDark: boolean
  /** 用于 Monaco / 标题栏 overlay 等需要布尔明暗判定的场景 */
  light: boolean
  font: FontTokens
  radius: RadiusTokens
  space: SpaceTokens
  shadow: ShadowTokens
  motion: MotionTokens
  color: ColorTokens
}

export interface FontTokens {
  /** 界面字体栈：Windows 优先微软雅黑，其余平台系统回退 */
  sans: string
  /** 代码 / 终端 / 哈希 / 路径字体栈 */
  mono: string
  baseSize: number
  baseLineHeight: string
  /** 字号层级：正文 14 / 分区标题 16 / 页面标题 20 / 强识别标题 24 */
  size: {
    body: number
    section: number
    page: number
    hero: number
    code: number
  }
  weight: {
    regular: number
    medium: number
    semibold: number
  }
  /** Markdown 正文行高 */
  proseLineHeight: string
  /** 代码块行高 */
  codeLineHeight: string
}

export interface RadiusTokens {
  sm: number
  md: number
  lg: number
  xl: number
  /** 会话行、气泡等大圆角 */
  bubble: number
  full: number
}

export interface SpaceTokens {
  xs: number
  sm: number
  md: number
  lg: number
  xl: number
  /** 会话行目标高度 */
  row: number
  /** IconButton 点击区域 */
  control: number
}

export interface ShadowTokens {
  /** 浮层：下拉、Popover、Tooltip */
  overlay: string
  /** 模态：Modal、Drawer */
  modal: string
  /** 轻浮起：卡片 hover */
  raised: string
}

export interface MotionTokens {
  fast: string
  base: string
  slow: string
  ease: string
}

export interface ColorTokens {
  surface: {
    app: string
    sidebar: string
    panel: string
    raised: string
    overlay: string
    hover: string
    active: string
  }
  border: {
    subtle: string
    default: string
    strong: string
    focus: string
  }
  text: {
    primary: string
    secondary: string
    muted: string
    inverse: string
    link: string
  }
  accent: {
    primary: string
    hover: string
    active: string
    soft: string
    contrastText: string
  }
  status: {
    success: string
    warning: string
    error: string
    info: string
    successSoft: string
    warningSoft: string
    errorSoft: string
    infoSoft: string
  }
  code: {
    editor: string
    inline: string
    block: string
    diffAdd: string
    diffRemove: string
  }
}

/** 界面字体栈：微软雅黑优先，非 Windows 平台回退到系统字体 */
export const FONT_SANS = [
  '"Microsoft YaHei"',
  '"微软雅黑"',
  '"PingFang SC"',
  '"Noto Sans CJK SC"',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif'
].join(', ')

/** 代码与终端字体栈：不强制使用微软雅黑 */
export const FONT_MONO = [
  '"JetBrains Mono"',
  '"Cascadia Code"',
  'Consolas',
  '"SF Mono"',
  'Menlo',
  'monospace'
].join(', ')

/** 默认强调色：克制的蓝色（取值见 shared/themePaint.ts 的对比度依据） */
export { DEFAULT_ACCENT }

/** 深色基线：中性冷灰，而不是偏蓝黑的高饱和底色 */
const DARK_BASE = {
  // 与主进程首帧兜底共用同一常量，避免两处取值漂移
  surfaceApp: FIRST_PAINT_BACKGROUND,
  surfaceSidebar: '#181b1e',
  surfacePanel: '#1a1d20',
  surfaceRaised: '#202428',
  surfaceOverlay: '#24282d',
  borderSubtle: '#23272b',
  borderDefault: '#2c3135',
  borderStrong: '#3a4046',
  textPrimary: FIRST_PAINT_SYMBOL,
  textSecondary: '#a8b0b8',
  textMuted: '#8b939b',
  accent: DEFAULT_ACCENT,
  success: '#3fb950',
  warning: '#d29922',
  error: '#f85149',
  info: '#4d9cf6'
} as const

/** 浅色基线：与深色保持相同的层级关系 */
const LIGHT_BASE = {
  surfaceApp: '#f5f6f8',
  surfaceSidebar: '#eef1f5',
  surfacePanel: '#f9fafb',
  surfaceRaised: '#ffffff',
  surfaceOverlay: '#ffffff',
  borderSubtle: '#e1e5ea',
  borderDefault: '#cfd5dd',
  borderStrong: '#aeb7c2',
  textPrimary: '#1c1f23',
  textSecondary: '#4d5661',
  textMuted: '#66707c',
  accent: DEFAULT_ACCENT,
  success: '#1a7f37',
  warning: '#9a6700',
  error: '#cf222e',
  info: '#0969da'
} as const

/* ---------------- 颜色工具（纯函数） ---------------- */

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

function toHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((value) =>
        Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
      )
      .join('')
  )
}

/** 混合两个颜色（t = 第二个颜色的占比） */
export function mix(a: string, b: string, t: number): string {
  const ca = normalizeHexColor(a) ?? '#000000'
  const cb = normalizeHexColor(b) ?? '#000000'
  const [r1, g1, b1] = channels(ca)
  const [r2, g2, b2] = channels(cb)
  const ratio = Math.max(0, Math.min(1, t))
  return toHex([
    r1 * (1 - ratio) + r2 * ratio,
    g1 * (1 - ratio) + g2 * ratio,
    b1 * (1 - ratio) + b2 * ratio
  ])
}

/** 相对亮度（0~1），WCAG 定义 */
export function luminance(hex: string): number {
  const normalized = normalizeHexColor(hex) ?? '#000000'
  const rgb = channels(normalized).map((value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

/** WCAG 对比度（1~21） */
export function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

/** 把前景色朝黑或白调整，直到在背景上达到最低对比度 */
export function ensureContrast(foreground: string, background: string, minimum = 4.5): string {
  const normalized = normalizeHexColor(foreground) ?? '#000000'
  if (contrast(normalized, background) >= minimum) return normalized

  const target = contrast('#ffffff', background) >= contrast('#000000', background) ? '#ffffff' : '#000000'
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(normalized, target, step / 20)
    if (contrast(candidate, background) >= minimum) return candidate
  }
  return target
}

/**
 * 在候选色中挑选「对比度最高且达标」者，用于强调色上的文字。
 *
 * 为什么需要 minimum：仅取最高对比度会选中黑字（黑字在中等亮度强调色上
 * 数学上更高），但实心按钮配黑字观感差。因此先要求首选候选达标，
 * 达标才用它；否则退回对比度最高的候选，保证不会出现低对比文字。
 */
export function bestOn(
  background: string,
  candidates: readonly string[],
  minimum = 4.5
): string {
  /*
   * 依次检查候选，返回第一个达标者 —— 候选顺序即优先级，
   * 调用方把观感更好的白色放在前面。
   *
   * 注意不要写成「取对比度最高者后判断是否达标」：那样在首选不达标时
   * 仍可能返回未达标的首选（实测红底上白字 4.00 < 4.5 却仍被返回）。
   */
  for (const candidate of candidates) {
    if (contrast(candidate, background) >= minimum) return candidate
  }
  // 没有任何候选达标时才退回对比度最高者，保证至少有最优可读性
  let best = candidates[0]
  let bestRatio = contrast(best, background)
  for (const candidate of candidates.slice(1)) {
    const ratio = contrast(candidate, background)
    if (ratio > bestRatio) {
      best = candidate
      bestRatio = ratio
    }
  }
  return best
}

/** 转成 rgba()，用于柔和背景层 */
export function alpha(hex: string, value: number): string {
  const normalized = normalizeHexColor(hex) ?? '#000000'
  const [r, g, b] = channels(normalized)
  const a = Math.max(0, Math.min(1, value))
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`
}

/** 由明暗模式挑选基线色板 */
export function basePalette(isDark: boolean): typeof DARK_BASE | typeof LIGHT_BASE {
  return isDark ? DARK_BASE : LIGHT_BASE
}

/* ---------------- 令牌解析 ---------------- */

export interface ResolveThemeOptions {
  /** 主题模式，默认 system */
  mode?: ThemeMode
  /** 实际生效的明暗（system 模式下由系统偏好解析后传入） */
  isDark?: boolean
  /** 用户覆盖 */
  overrides?: ThemeOverrides | null
  /** UI 字号基准，阶段 A 固定 14 */
  uiFontSize?: number
}

/**
 * 由「模式 + 系统明暗 + 用户覆盖」解析出完整令牌集。
 * 用户的背景色与文字色会重新派生悬浮层、边框、弱文本，
 * 强调色会派生 hover / active / soft / contrastText 与焦点环。
 */
export function resolveTheme(options: ResolveThemeOptions = {}): ResolvedTheme {
  const requestedMode = options.mode ?? 'system'
  // system 模式读取真实系统偏好；外部显式传入的 isDark 始终优先。
  const systemDark =
    requestedMode === 'system' && options.isDark === undefined ? systemPrefersDark() : undefined
  let isDark = options.isDark ?? systemDark ?? (requestedMode === 'dark')
  const overrides = sanitizeThemeOverrides(options.overrides) ?? {}
  // 阶段 A 固定 14px：接口保留，但设置页暂不开放调节，避免未验证的布局溢出。
  const baseSize = overrides.uiFontSize ?? options.uiFontSize ?? DEFAULT_UI_FONT_SIZE

  // ---- 表面层级：自定义背景色时按模式方向重新派生 ----
  const rawSurfaceApp = overrides.bg ?? basePalette(isDark).surfaceApp

  // 用户把背景改成与当前模式相反的极值（例如浅色模式填纯黑）时，
  // 按背景明度重新判定明暗，避免出现「深底深字」的不可读组合。
  // 只在「用户显式选择了浅色/深色 + 自定义背景」时启用；
  // system 模式与调用方显式传入的 isDark 始终优先，
  // 以便跟随系统主题的结果不被自定义背景改写。
  if (requestedMode !== 'system' && !overrides.text && options.isDark === undefined) {
    const bgLuminance = luminance(rawSurfaceApp)
    if (isDark && bgLuminance > 0.5) isDark = false
    else if (!isDark && bgLuminance < 0.22) isDark = true
  }

  const base = basePalette(isDark)
  const surfaceApp = rawSurfaceApp
  const toward = isDark ? '#ffffff' : '#000000'
  const step = (t: number): string => mix(surfaceApp, toward, t)
  const surfaceSidebar = overrides.bg ? step(isDark ? 0.026 : 0.024) : base.surfaceSidebar
  const surfacePanel = overrides.bg ? step(isDark ? 0.035 : 0.012) : base.surfacePanel
  const surfaceRaised = overrides.bg ? step(isDark ? 0.062 : 0.05) : base.surfaceRaised
  const surfaceOverlay = overrides.bg ? step(isDark ? 0.082 : 0.062) : base.surfaceOverlay

  // ---- 文字层级：自定义文字色时向背景收敛得到次要 / 弱文本 ----
  // 正文必须始终在应用背景上可读：即使用户把文字填成与背景同色，
  // 也会被自动补足，避免出现「看起来没字」的界面；
  // 用户指定的合法文字色在达标时会被原样保留。
  const textPrimary = ensureContrast(overrides.text ?? base.textPrimary, surfaceApp, 4.5)
  const textSecondary = ensureContrast(
    overrides.text ? mix(overrides.text, surfaceApp, 0.3) : base.textSecondary,
    surfaceRaised,
    4.5
  )
  const textMuted = ensureContrast(
    overrides.text ? mix(overrides.text, surfaceApp, 0.44) : base.textMuted,
    surfaceApp,
    4.5
  )

  // ---- 强调色派生 ----
  const accentPrimary = overrides.accent ?? base.accent
  // 统一向黑派生：交互态更深，白字对比度随之升高
  const accentHover = mix(accentPrimary, '#000000', 0.14)
  const accentActive = mix(accentPrimary, '#000000', 0.24)
  // 强调色上的文字：取白/黑中对比度更高者
  const accentContrastText = bestOn(accentPrimary, ['#ffffff', '#000000'])
  // 焦点环：以强调色为准，对比不足时向背景方向补足
  const borderFocus = ensureContrast(accentPrimary, surfaceApp, 3)

  // 边框必须始终可辨识：即使自定义背景为纯黑或纯白也保持最小对比度。
  const borderSubtle = ensureContrast(
    overrides.bg ? step(isDark ? 0.1 : 0.06) : base.borderSubtle,
    surfaceApp,
    1.14
  )
  const borderDefault = ensureContrast(
    overrides.bg ? step(isDark ? 0.16 : 0.12) : base.borderDefault,
    surfaceApp,
    1.24
  )
  const borderStrong = ensureContrast(
    overrides.bg ? step(isDark ? 0.24 : 0.2) : base.borderStrong,
    surfaceApp,
    1.4
  )

  return {
    mode: requestedMode,
    isDark,
    light: !isDark,
    font: {
      sans: FONT_SANS,
      mono: FONT_MONO,
      baseSize,
      baseLineHeight: '22px',
      size: {
        body: baseSize,
        section: 16,
        page: 20,
        hero: 24,
        code: baseSize
      },
      weight: { regular: 400, medium: 500, semibold: 600 },
      proseLineHeight: '1.65',
      codeLineHeight: '1.5'
    },
    radius: { sm: 4, md: 6, lg: 10, xl: 14, bubble: 12, full: 999 },
    space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, row: 42, control: 32 },
    shadow: {
      overlay: isDark
        ? '0 8px 24px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.35)'
        : '0 8px 24px rgba(16, 20, 26, 0.12), 0 2px 6px rgba(16, 20, 26, 0.08)',
      modal: isDark
        ? '0 16px 48px rgba(0, 0, 0, 0.6)'
        : '0 16px 48px rgba(16, 20, 26, 0.18)',
      raised: isDark
        ? '0 2px 8px rgba(0, 0, 0, 0.4)'
        : '0 2px 8px rgba(16, 20, 26, 0.08)'
    },
    motion: { fast: '120ms', base: '180ms', slow: '260ms', ease: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    color: {
      surface: {
        app: surfaceApp,
        sidebar: surfaceSidebar,
        panel: surfacePanel,
        raised: surfaceRaised,
        overlay: surfaceOverlay,
        hover: alpha(isDark ? '#ffffff' : '#000000', isDark ? 0.05 : 0.04),
        active: alpha(isDark ? '#ffffff' : '#000000', isDark ? 0.09 : 0.07)
      },
      border: {
        subtle: borderSubtle,
        default: borderDefault,
        strong: borderStrong,
        focus: borderFocus
      },
      text: {
        primary: textPrimary,
        secondary: textSecondary,
        muted: textMuted,
        inverse: isDark ? '#111315' : '#ffffff',
        link: ensureContrast(accentPrimary, surfaceApp, 4.5)
      },
      accent: {
        primary: accentPrimary,
        hover: accentHover,
        active: accentActive,
        soft: alpha(accentPrimary, isDark ? 0.16 : 0.1),
        contrastText: accentContrastText
      },
      status: {
        // 状态色需要同时满足「当文字用」和「当指示点用」，
        // 因此以内容表面为基准做对比度兜底。
        success: ensureContrast(base.success, surfaceApp, 3),
        warning: ensureContrast(base.warning, surfaceApp, 3),
        error: ensureContrast(base.error, surfaceApp, 3),
        info: ensureContrast(base.info, surfaceApp, 3),
        successSoft: alpha(base.success, isDark ? 0.16 : 0.12),
        warningSoft: alpha(base.warning, isDark ? 0.16 : 0.12),
        errorSoft: alpha(base.error, isDark ? 0.16 : 0.12),
        infoSoft: alpha(base.info, isDark ? 0.16 : 0.12)
      },
      code: {
        editor: isDark ? mix(surfaceApp, '#000000', 0.25) : '#ffffff',
        inline: alpha(isDark ? '#ffffff' : '#000000', isDark ? 0.06 : 0.05),
        block: isDark ? mix(surfaceApp, '#000000', 0.35) : '#f2f3f5',
        diffAdd: alpha(base.success, isDark ? 0.16 : 0.14),
        diffRemove: alpha(base.error, isDark ? 0.16 : 0.14)
      }
    }
  }
}

/** 供测试与外部断言使用的令牌路径清单 */
export const THEME_TOKEN_PATHS = [
  'surface.app',
  'surface.sidebar',
  'surface.panel',
  'surface.raised',
  'surface.overlay',
  'surface.hover',
  'surface.active',
  'border.subtle',
  'border.default',
  'border.strong',
  'border.focus',
  'text.primary',
  'text.secondary',
  'text.muted',
  'text.inverse',
  'text.link',
  'accent.primary',
  'accent.hover',
  'accent.active',
  'accent.soft',
  'accent.contrastText',
  'status.success',
  'status.warning',
  'status.error',
  'status.info',
  'status.successSoft',
  'status.warningSoft',
  'status.errorSoft',
  'status.infoSoft',
  'code.editor',
  'code.inline',
  'code.block',
  'code.diffAdd',
  'code.diffRemove'
] as const
