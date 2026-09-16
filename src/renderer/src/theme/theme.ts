/**
 * 兼容层：保留阶段 A 之前存在的主题导出名，避免一次性改动所有业务组件。
 *
 * 真实实现已经搬到：
 * - `tokens.ts`            —— 语义令牌与派生算法（纯函数）
 * - `applyTheme.ts`        —— CSS 变量、系统主题、Ant Design 映射
 * - `systemTheme.ts`       —— 系统深浅色读取与订阅
 * - `stores/themeStore.ts` —— 主题模式、覆盖与持久化
 *
 * 本文件里带 `@deprecated` 的导出只服务于尚未迁移的旧组件
 * （SettingsPage 的主题卡片、StatusBar 的主题名），
 * 会在阶段 B/D 迁移完成后删除。新代码请直接从上述模块导入。
 */
import {
  DEFAULT_THEME_MODE,
  LEGACY_PRESET_MODE_MAP as PRESET_MODE,
  normalizeHexColor,
  type ThemeMode,
  type ThemeOverrides
} from '@shared/themePreferences'
import {
  applyThemeToRoot,
  subscribeSystemTheme,
  systemPrefersDark,
  toAntdTheme,
  toCssVariables
} from './applyTheme'
import {
  FONT_MONO,
  FONT_SANS,
  basePalette,
  contrast,
  ensureContrast,
  luminance,
  mix,
  resolveTheme,
  type ResolvedTheme
} from './tokens'

export type { ThemeMode, ThemeOverrides, ResolvedTheme }
export {
  FONT_MONO,
  FONT_SANS,
  applyThemeToRoot,
  basePalette,
  contrast,
  ensureContrast,
  luminance,
  mix,
  resolveTheme,
  subscribeSystemTheme,
  systemPrefersDark,
  toAntdTheme,
  toCssVariables
}

/** 默认主题模式：跟随系统 */
export const DEFAULT_MODE: ThemeMode = DEFAULT_THEME_MODE

/* ---------------- 旧 API 兼容 ---------------- */

/** @deprecated 旧的预设主题结构，仅用于未迁移组件 */
export interface ThemePreset {
  id: string
  name: string
  light: boolean
  accent: string
  accentDim: string
  bgApp: string
  bgPanel: string
  bgRaised: string
  bgActive: string
  border: string
  borderStrong: string
  textPrimary: string
  textSecondary: string
  textMuted: string
}

/** @deprecated 旧默认预设 id */
export const DEFAULT_THEME_ID = 'midnight'

/**
 * @deprecated 旧的主题预设列表。
 *
 * 新的主题系统只有「跟随系统 / 浅色 / 深色」三种模式，
 * 这里保留旧预设仅因为它仍被 SettingsPage 的主题卡片渲染使用；
 * 每个条目的颜色都由当前令牌引擎生成，保证预览与实际外观一致。
 */
export const THEMES: ThemePreset[] = [
  legacyPresetFrom('midnight', '午夜蓝', true),
  legacyPresetFrom('daylight', '日光（浅色）', false)
]

function legacyPresetFrom(id: string, name: string, isDark: boolean): ThemePreset {
  return legacyPresetFromResolved(id, name, resolveTheme({ mode: isDark ? 'dark' : 'light', isDark }))
}

function legacyPresetFromResolved(id: string, name: string, theme: ResolvedTheme): ThemePreset {
  return {
    id,
    name,
    light: theme.light,
    accent: theme.color.accent.primary,
    accentDim: mix(theme.color.accent.primary, theme.color.surface.app, 0.45),
    bgApp: theme.color.surface.app,
    bgPanel: theme.color.surface.sidebar,
    bgRaised: theme.color.surface.raised,
    bgActive: theme.color.surface.active,
    border: theme.color.border.default,
    borderStrong: theme.color.border.strong,
    textPrimary: theme.color.text.primary,
    textSecondary: theme.color.text.secondary,
    textMuted: theme.color.text.muted
  }
}

/**
 * @deprecated 把新令牌集映射回旧的 ThemePreset 结构。
 * 只用于尚未迁移的组件；新代码请直接读取 ResolvedTheme。
 */
export function toLegacyPreset(theme: ResolvedTheme, name?: string): ThemePreset {
  return legacyPresetFromResolved(theme.mode, name ?? (theme.light ? '浅色' : '深色'), theme)
}

/**
 * @deprecated 旧的按 id 取主题。
 *
 * 新结构里 presetId 已降级为兼容镜像，因此这里按「旧 id → 模式」解析；
 * 未迁移组件请改用 toLegacyPreset(resolvedTheme)。
 */
export function getTheme(id: string): ThemePreset {
  const mode = PRESET_MODE[id]
  if (mode) {
    return legacyPresetFrom(id, mode === 'light' ? '日光（浅色）' : '午夜蓝', mode === 'dark')
  }
  return THEMES[0]
}

/** @deprecated 旧的颜色规范化函数，改用 normalizeHexColor */
export function normalizeHex(input: string): string | null {
  return normalizeHexColor(input)
}

/** @deprecated 旧的颜色混合函数，改用 mix */
export function mixHex(a: string, b: string, t: number): string {
  return mix(a, b, t)
}

/** @deprecated 旧的亮度函数，改用 luminance */
export function luminanceHex(hex: string): number {
  return luminance(hex)
}

/** @deprecated 旧的对比度函数，改用 contrast */
export function contrastRatio(foreground: string, background: string): number {
  return contrast(foreground, background)
}

/** @deprecated 旧的强调色派生，改用 mix */
export function accentDimFrom(hex: string): string {
  const normalized = normalizeHexColor(hex)
  if (!normalized) return '#33427f'
  return mix(normalized, '#000000', 0.55)
}

/**
 * @deprecated 旧的「基色 + 覆盖」合成函数。
 * 新实现请改用 resolveTheme（返回完整语义令牌集）。
 */
export function buildTheme(base: ThemePreset, overrides: ThemeOverrides): ThemePreset {
  const theme = resolveTheme({ mode: base.light ? 'light' : 'dark', isDark: !base.light, overrides })
  return legacyPresetFromResolved(base.id, base.name, theme)
}

/** @deprecated 旧的应用入口，改用 applyThemeToRoot(ResolvedTheme) */
export function applyTheme(t: ThemePreset): void {
  applyThemeToRoot(
    resolveTheme({
      mode: t.light ? 'light' : 'dark',
      isDark: !t.light,
      overrides: { bg: t.bgApp, text: t.textPrimary, accent: t.accent }
    })
  )
}
