/**
 * 主进程 / 预加载 / 渲染进程共享的主题设置契约与迁移逻辑。
 *
 * 该文件必须保持“纯函数 + 无副作用 + 不依赖 DOM / Electron”：
 * 主进程用它做落盘校验与迁移写回，渲染进程用同一份函数保证理解一致，
 * 单测可以直接覆盖旧版本设置的迁移行为。
 */

/** 主题模式：跟随系统 / 固定浅色 / 固定深色 */
export type ThemeMode = 'system' | 'light' | 'dark'

/** 用户可单独自定义的颜色与字号覆盖 */
export interface ThemeOverrides {
  bg?: string
  text?: string
  accent?: string
  /** UI 字号基准（px）。阶段 A 固定为 14，仅保留字段待后续开放。 */
  uiFontSize?: number
}

/** 持久化的主题设置（版本化结构） */
export interface PersistedTheme {
  /** 结构版本号；当前为 2（mode + overrides） */
  version?: number
  /** 主题模式，省略时按 presetId 回退推导 */
  mode?: ThemeMode
  overrides: ThemeOverrides
  /**
   * @deprecated 旧版字段，仅用于读取历史设置。
   * 写入时会镜像当前实际模式，保证旧版本回退读取时仍能拿到合理结果。
   */
  presetId?: string
}

/** 当前主题设置结构版本 */
export const THEME_SCHEMA_VERSION = 2

/** 默认主题模式：新安装跟随系统 */
export const DEFAULT_THEME_MODE: ThemeMode = 'system'

/** UI 字号基准默认值与允许范围（阶段 A 固定不开放调节） */
export const DEFAULT_UI_FONT_SIZE = 14
export const UI_FONT_SIZE_MIN = 12
export const UI_FONT_SIZE_MAX = 16

/** 模式选项的中文标签，供设置页与状态栏复用 */
export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色'
}

/**
 * 旧版本主题预设 → 新模式 的映射。
 * 深色预设保留为 dark；daylight 映射为 light；
 * 未知/缺失的旧值回退到 dark 以匹配旧版默认的午夜蓝。
 */
export const LEGACY_PRESET_MODE_MAP: Record<string, ThemeMode> = {
  midnight: 'dark',
  obsidian: 'dark',
  forest: 'dark',
  amber: 'dark',
  daylight: 'light'
}

/**
 * 旧预设的视觉特征（背景 + 强调色）。
 *
 * 迁移时不追求复刻旧预设的完整色板，但必须保留用户当前看到的
 * 强调色与背景基调，否则升级后会“莫名换肤”。这些值会转成
 * 新结构的 overrides，用户可以随时通过「一键恢复默认」清掉。
 */
export const LEGACY_PRESET_SEEDS: Record<string, { bg: string; accent: string }> = {
  midnight: { bg: '#0a0e17', accent: '#5271ff' },
  obsidian: { bg: '#0b0b0e', accent: '#a78bfa' },
  forest: { bg: '#0a0e17', accent: '#3fb950' },
  amber: { bg: '#0a0e17', accent: '#e08a3c' },
  daylight: { bg: '#f6f7f9', accent: '#2563eb' }
}

/** 模式 → 兼容用的历史预设 id（写回 presetId 时使用） */
export const MODE_LEGACY_PRESET_ID: Record<ThemeMode, string> = {
  system: 'midnight',
  light: 'daylight',
  dark: 'midnight'
}

/** 校验并规范化 hex 颜色（支持 #rgb / #rrggbb，大小写不敏感，可省略 #） */
export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let value = input.trim().replace(/^#/, '')
  if (value.length === 3) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('')
  }
  if (value.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(value)) return null
  return `#${value.toLowerCase()}`
}

/** 判断任意输入是否为合法主题模式 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** 规范化字号：非法值回退默认，超出范围夹取到边界 */
export function normalizeUiFontSize(value: unknown): number {
  const size = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(size)) return DEFAULT_UI_FONT_SIZE
  const rounded = Math.round(size)
  if (rounded < UI_FONT_SIZE_MIN) return UI_FONT_SIZE_MIN
  if (rounded > UI_FONT_SIZE_MAX) return UI_FONT_SIZE_MAX
  return rounded
}

/**
 * 清洗覆盖项：丢弃非法颜色与非数值字号，输出稳定顺序的新对象。
 * 返回 undefined 表示没有任何有效覆盖。
 */
export function sanitizeThemeOverrides(input: unknown): ThemeOverrides | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Record<string, unknown>
  const next: ThemeOverrides = {}

  const bg = normalizeHexColor(raw.bg)
  if (bg) next.bg = bg
  const text = normalizeHexColor(raw.text)
  if (text) next.text = text
  const accent = normalizeHexColor(raw.accent)
  if (accent) next.accent = accent
  if (raw.uiFontSize != null) {
    const size = Number(raw.uiFontSize)
    if (Number.isFinite(size)) next.uiFontSize = normalizeUiFontSize(size)
  }

  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * 由旧 presetId 推导主题模式。
 * 缺失或未知时回退到 dark，保持与旧版默认午夜蓝一致的观感。
 */
export function modeFromLegacyPresetId(presetId: unknown): ThemeMode {
  if (typeof presetId === 'string' && LEGACY_PRESET_MODE_MAP[presetId]) {
    return LEGACY_PRESET_MODE_MAP[presetId]
  }
  return 'dark'
}

/** 把解析结果整理成可持久化的最终结构（写入 presetId 镜像以便旧版本回退读取） */
function finalize(mode: ThemeMode, overrides: ThemeOverrides | undefined): PersistedTheme {
  const next: PersistedTheme = {
    version: THEME_SCHEMA_VERSION,
    mode,
    overrides: overrides ?? {},
    presetId: MODE_LEGACY_PRESET_ID[mode]
  }
  return next
}

/**
 * 解析任意来源的主题设置，兼容三种历史形态：
 * 1. 顶层直接是主题对象（`{ presetId, overrides }`）；
 * 2. `{ theme: { presetId, overrides } }` 包裹结构；
 * 3. 新版 `{ version, mode, overrides }`。
 *
 * 任何非法输入都不会抛错，一律回退到「跟随系统 + 无覆盖」，
 * 保证迁移失败不会影响应用启动。
 */
export function resolveThemeSettings(input: unknown): PersistedTheme {
  if (!input || typeof input !== 'object') {
    return finalize(DEFAULT_THEME_MODE, undefined)
  }

  const root = input as Record<string, unknown>
  // 形态 2：被 theme 字段包裹
  const candidate =
    root.theme && typeof root.theme === 'object' ? (root.theme as Record<string, unknown>) : root
  // 形态 1 的历史兼容：顶层直接放了 presetId
  const directPresetId = typeof root.presetId === 'string' ? root.presetId : undefined

  const overrides = sanitizeThemeOverrides(candidate.overrides)
  const explicitMode = isThemeMode(candidate.mode) ? candidate.mode : undefined
  const presetId =
    typeof candidate.presetId === 'string' ? candidate.presetId : directPresetId

  // 有显式 mode 时以 mode 为准；否则由旧 presetId 推导
  const presetDerived = explicitMode === undefined && !!presetId
  const mode = explicitMode ?? (presetId ? modeFromLegacyPresetId(presetId) : DEFAULT_THEME_MODE)

  // 旧结构升级到新结构时，把旧预设的强调色与背景基调转成覆盖，
  // 避免用户升级后看到与之前不同的配色。
  const seeded = presetDerived && !overrides ? legacySeedOverrides(presetId) : undefined

  return finalize(mode, overrides ?? seeded)
}

/** 由旧预设 id 提取需要保留为覆盖的颜色 */
function legacySeedOverrides(presetId: unknown): ThemeOverrides | undefined {
  if (typeof presetId !== 'string') return undefined
  const seed = LEGACY_PRESET_SEEDS[presetId]
  if (!seed) return undefined
  return { bg: seed.bg, accent: seed.accent }
}

/** 判断持久化设置是否已是当前结构（用于决定是否需要迁移写回） */
export function isCurrentThemeSchema(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const root = input as Record<string, unknown>
  const candidate =
    root.theme && typeof root.theme === 'object' ? (root.theme as Record<string, unknown>) : root
  return candidate.version === THEME_SCHEMA_VERSION && isThemeMode(candidate.mode)
}
