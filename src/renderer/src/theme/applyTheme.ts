/**
 * 令牌应用层：把 ResolvedTheme 落到 CSS 变量与系统主题监听。
 *
 * 分工：
 * - `tokens.ts`      负责「算什么值」，纯函数；
 * - 本文件            负责「写到哪」，是唯一允许触碰 document 的主题模块；
 * - `antdTheme.ts`   负责令牌 → Ant Design ThemeConfig（强类型校验）；
 * - `systemTheme.ts` 负责系统深浅色读取与订阅。
 *
 * 旧变量名（--bg-app / --border / --ok / --warn / --err 等）在本阶段继续输出，
 * 保证未迁移的业务组件外观不回归。
 */
import type { ResolvedTheme } from './tokens'

/** 设计令牌 → CSS 变量名 */
export const THEME_VAR_NAMES = {
  surfaceApp: '--surface-app',
  surfaceSidebar: '--surface-sidebar',
  surfacePanel: '--surface-panel',
  surfaceRaised: '--surface-raised',
  surfaceOverlay: '--surface-overlay',
  surfaceHover: '--surface-hover',
  surfaceActive: '--surface-active',

  borderSubtle: '--border-subtle',
  borderDefault: '--border-default',
  borderStrong: '--border-strong',
  borderFocus: '--border-focus',

  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textMuted: '--text-muted',
  textInverse: '--text-inverse',
  textLink: '--text-link',

  accent: '--accent',
  accentHover: '--accent-hover',
  accentActive: '--accent-active',
  accentSoft: '--accent-soft',
  accentContrastText: '--accent-contrast-text',

  statusSuccess: '--status-success',
  statusWarning: '--status-warning',
  statusError: '--status-error',
  statusInfo: '--status-info',
  statusSuccessSoft: '--status-success-soft',
  statusWarningSoft: '--status-warning-soft',
  statusErrorSoft: '--status-error-soft',
  statusInfoSoft: '--status-info-soft',

  codeEditor: '--code-editor',
  codeInline: '--code-inline',
  codeBlock: '--code-block',
  codeDiffAdd: '--code-diff-add',
  codeDiffRemove: '--code-diff-remove',

  fontSans: '--font-sans',
  fontMono: '--font-mono',
  fontSizeBase: '--font-size-base',
  lineHeightBase: '--line-height-base',

  radiusSm: '--radius-sm',
  radiusMd: '--radius-md',
  radiusLg: '--radius-lg',
  radiusXl: '--radius-xl',
  radiusBubble: '--radius-bubble',
  radiusFull: '--radius-full',

  shadowOverlay: '--shadow-overlay',
  shadowModal: '--shadow-modal',
  shadowRaised: '--shadow-raised',

  motionFast: '--motion-fast',
  motionBase: '--motion-base',
  motionSlow: '--motion-slow',
  motionEase: '--motion-ease',

  /* ---- 旧变量别名（阶段 A 兼容，阶段 E 清理） ---- */
  legacyBgApp: '--bg-app',
  legacyBgPanel: '--bg-panel',
  legacyBgRaised: '--bg-raised',
  legacyBgActive: '--bg-active',
  legacyBorder: '--border',
  legacyOk: '--ok',
  legacyWarn: '--warn',
  legacyErr: '--err'
} as const

/**
 * 解析后的令牌 → CSS 变量。
 *
 * 旧变量别名映射到新语义令牌：
 * - `--bg-panel` 指向 surface.sidebar，与阶段 A 之前的 `--bg-panel` 取值一致，
 *   避免侧栏等未迁移区域出现色差；
 * - `--border` 指向 border.default。
 */
export function toCssVariables(theme: ResolvedTheme): Record<string, string> {
  const { color, font, radius, shadow, motion } = theme
  return {
    [THEME_VAR_NAMES.surfaceApp]: color.surface.app,
    [THEME_VAR_NAMES.surfaceSidebar]: color.surface.sidebar,
    [THEME_VAR_NAMES.surfacePanel]: color.surface.panel,
    [THEME_VAR_NAMES.surfaceRaised]: color.surface.raised,
    [THEME_VAR_NAMES.surfaceOverlay]: color.surface.overlay,
    [THEME_VAR_NAMES.surfaceHover]: color.surface.hover,
    [THEME_VAR_NAMES.surfaceActive]: color.surface.active,

    [THEME_VAR_NAMES.borderSubtle]: color.border.subtle,
    [THEME_VAR_NAMES.borderDefault]: color.border.default,
    [THEME_VAR_NAMES.borderStrong]: color.border.strong,
    [THEME_VAR_NAMES.borderFocus]: color.border.focus,

    [THEME_VAR_NAMES.textPrimary]: color.text.primary,
    [THEME_VAR_NAMES.textSecondary]: color.text.secondary,
    [THEME_VAR_NAMES.textMuted]: color.text.muted,
    [THEME_VAR_NAMES.textInverse]: color.text.inverse,
    [THEME_VAR_NAMES.textLink]: color.text.link,

    [THEME_VAR_NAMES.accent]: color.accent.primary,
    [THEME_VAR_NAMES.accentHover]: color.accent.hover,
    [THEME_VAR_NAMES.accentActive]: color.accent.active,
    [THEME_VAR_NAMES.accentSoft]: color.accent.soft,
    [THEME_VAR_NAMES.accentContrastText]: color.accent.contrastText,

    [THEME_VAR_NAMES.statusSuccess]: color.status.success,
    [THEME_VAR_NAMES.statusWarning]: color.status.warning,
    [THEME_VAR_NAMES.statusError]: color.status.error,
    [THEME_VAR_NAMES.statusInfo]: color.status.info,
    [THEME_VAR_NAMES.statusSuccessSoft]: color.status.successSoft,
    [THEME_VAR_NAMES.statusWarningSoft]: color.status.warningSoft,
    [THEME_VAR_NAMES.statusErrorSoft]: color.status.errorSoft,
    [THEME_VAR_NAMES.statusInfoSoft]: color.status.infoSoft,

    [THEME_VAR_NAMES.codeEditor]: color.code.editor,
    [THEME_VAR_NAMES.codeInline]: color.code.inline,
    [THEME_VAR_NAMES.codeBlock]: color.code.block,
    [THEME_VAR_NAMES.codeDiffAdd]: color.code.diffAdd,
    [THEME_VAR_NAMES.codeDiffRemove]: color.code.diffRemove,

    [THEME_VAR_NAMES.fontSans]: font.sans,
    [THEME_VAR_NAMES.fontMono]: font.mono,
    [THEME_VAR_NAMES.fontSizeBase]: `${font.baseSize}px`,
    [THEME_VAR_NAMES.lineHeightBase]: font.baseLineHeight,

    [THEME_VAR_NAMES.radiusSm]: `${radius.sm}px`,
    [THEME_VAR_NAMES.radiusMd]: `${radius.md}px`,
    [THEME_VAR_NAMES.radiusLg]: `${radius.lg}px`,
    [THEME_VAR_NAMES.radiusXl]: `${radius.xl}px`,
    [THEME_VAR_NAMES.radiusBubble]: `${radius.bubble}px`,
    [THEME_VAR_NAMES.radiusFull]: `${radius.full}px`,

    [THEME_VAR_NAMES.shadowOverlay]: shadow.overlay,
    [THEME_VAR_NAMES.shadowModal]: shadow.modal,
    [THEME_VAR_NAMES.shadowRaised]: shadow.raised,

    [THEME_VAR_NAMES.motionFast]: motion.fast,
    [THEME_VAR_NAMES.motionBase]: motion.base,
    [THEME_VAR_NAMES.motionSlow]: motion.slow,
    [THEME_VAR_NAMES.motionEase]: motion.ease,

    // 旧变量别名：保持既有组件外观不变
    [THEME_VAR_NAMES.legacyBgApp]: color.surface.app,
    [THEME_VAR_NAMES.legacyBgPanel]: color.surface.sidebar,
    [THEME_VAR_NAMES.legacyBgRaised]: color.surface.raised,
    [THEME_VAR_NAMES.legacyBgActive]: color.surface.active,
    [THEME_VAR_NAMES.legacyBorder]: color.border.default,
    [THEME_VAR_NAMES.legacyOk]: color.status.success,
    [THEME_VAR_NAMES.legacyWarn]: color.status.warning,
    [THEME_VAR_NAMES.legacyErr]: color.status.error
  }
}

/** 把令牌写到根节点：CSS 变量 + color-scheme + dark class */
export function applyThemeToRoot(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [name, value] of Object.entries(toCssVariables(theme))) {
    root.style.setProperty(name, value)
  }
  // Tailwind darkMode: 'class' 继续生效
  root.classList.toggle('dark', !theme.light)
  root.style.colorScheme = theme.light ? 'light' : 'dark'
  root.dataset.themeMode = theme.mode
  root.dataset.themeResolved = theme.light ? 'light' : 'dark'
}

/* ---------------- 系统主题 ---------------- */

// 系统深浅色偏好的读取与订阅由 ./systemTheme 提供（tokens.ts 也需要它，
// 因此单独成文件避免循环依赖），这里只做转出，保持调用方 import 路径稳定。
export {
  isSystemThemeSupported,
  subscribeSystemTheme,
  systemPrefersDark
} from './systemTheme'

/* ---------------- Ant Design 映射 ---------------- */

// toAntdTheme 拆分到 ./antdTheme：它对 antd 的 ThemeConfig 有强类型依赖，
// 单独成文件后可以用真实类型做校验（见该文件顶部说明）。
export { toAntdTheme } from './antdTheme'

/** 便捷入口：一步得到根节点已应用的主题（供 store 调用） */
export function applyResolvedTheme(theme: ResolvedTheme): ResolvedTheme {
  applyThemeToRoot(theme)
  return theme
}

export { resolveTheme } from './tokens'
export type { ResolvedTheme } from './tokens'
