/** 主题预设：每套主题定义一组覆盖到 :root 的 CSS 变量。 */
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

/** 用户可单独自定义的颜色覆盖（背景 / 文字 / 强调色） */
export interface ThemeOverrides {
  bg?: string
  text?: string
  accent?: string
}

/** 深色基础色板（各深色主题共用背景，突出不同的强调色） */
const darkBase = {
  light: false,
  bgApp: '#0a0e17',
  bgPanel: '#0f141e',
  bgRaised: '#151b28',
  bgActive: '#1a2233',
  border: '#1d2534',
  borderStrong: '#2a3547',
  textPrimary: '#e6e9ef',
  textSecondary: '#98a1b3',
  textMuted: '#7f899b'
}

/** 推荐主题（整体搭配：背景 + 文字 + 强调色） */
export const THEMES: ThemePreset[] = [
  { id: 'midnight', name: '午夜蓝', ...darkBase, accent: '#5271ff', accentDim: '#33427f' },
  { id: 'obsidian', name: '黑曜石', light: false, accent: '#a78bfa', accentDim: '#5b3fa8', bgApp: '#0b0b0e', bgPanel: '#111116', bgRaised: '#17171d', bgActive: '#1d1d25', border: '#22222b', borderStrong: '#2e2e3a', textPrimary: '#eef0f4', textSecondary: '#a0a4ae', textMuted: '#858995' },
  { id: 'forest', name: '深林绿', ...darkBase, accent: '#3fb950', accentDim: '#256f38' },
  { id: 'amber', name: '琥珀橙', ...darkBase, accent: '#e08a3c', accentDim: '#8a4f1f' },
  {
    id: 'daylight',
    name: '日光（浅色）',
    light: true,
    accent: '#2563eb',
    accentDim: '#93b4f5',
    bgApp: '#f6f7f9',
    bgPanel: '#ffffff',
    bgRaised: '#eef0f3',
    bgActive: '#e3e6ea',
    border: '#d9dde3',
    borderStrong: '#c4cad2',
    textPrimary: '#1f2328',
    textSecondary: '#57606a',
    textMuted: '#626c76'
  }
]

export const DEFAULT_THEME_ID = 'midnight'

/** 校验并规范化颜色：支持 #rgb / #rrggbb（可带或不带 #） */
export function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '')
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  if (s.length === 6 && /^[0-9a-fA-F]{6}$/.test(s)) return '#' + s.toLowerCase()
  return null
}

/** 混合两个 hex 颜色（t = 第二个颜色的占比） */
export function mixHex(a: string, b: string, t: number): string {
  const na = normalizeHex(a) ?? '#000000'
  const nb = normalizeHex(b) ?? '#ffffff'
  const ca = [na.slice(1, 3), na.slice(3, 5), na.slice(5, 7)].map((x) => parseInt(x, 16))
  const cb = [nb.slice(1, 3), nb.slice(3, 5), nb.slice(5, 7)].map((x) => parseInt(x, 16))
  const out = ca.map((x, i) => Math.round(x * (1 - t) + cb[i] * t))
  return '#' + out.map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** 相对亮度（0~1），用于判断深/浅色 */
export function luminanceHex(hex: string): number {
  const n = normalizeHex(hex) ?? '#000000'
  const ch = [n.slice(1, 3), n.slice(3, 5), n.slice(5, 7)].map((x) => parseInt(x, 16) / 255)
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(ch[0]) + 0.7152 * lin(ch[1]) + 0.0722 * lin(ch[2])
}

/** WCAG 对比度（1~21）。 */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminanceHex(foreground), luminanceHex(background))
  const darker = Math.min(luminanceHex(foreground), luminanceHex(background))
  return (lighter + 0.05) / (darker + 0.05)
}

/** 将文字色向黑或白调整，保证在指定背景上达到最低对比度。 */
export function ensureContrast(foreground: string, background: string, minimum = 4.5): string {
  const normalized = normalizeHex(foreground) ?? '#000000'
  if (contrastRatio(normalized, background) >= minimum) return normalized

  const blackRatio = contrastRatio('#000000', background)
  const whiteRatio = contrastRatio('#ffffff', background)
  const target = whiteRatio >= blackRatio ? '#ffffff' : '#000000'
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(normalized, target, step / 20)
    if (contrastRatio(candidate, background) >= minimum) return candidate
  }
  return target
}

/** 由强调色派生更暗的 dim 色 */
export function accentDimFrom(hex: string): string {
  const n = normalizeHex(hex)
  if (!n) return '#33427f'
  const c = (i: number): string => Math.round(parseInt(n.slice(1 + i * 2, 3 + i * 2), 16) * 0.45).toString(16).padStart(2, '0')
  return `#${c(0)}${c(1)}${c(2)}`
}

function deriveFromBg(base: string): Pick<
  ThemePreset,
  'bgApp' | 'bgPanel' | 'bgRaised' | 'bgActive' | 'border' | 'borderStrong' | 'light'
> {
  const f = (t: number): string => mixHex(base, '#ffffff', t)
  return {
    bgApp: base,
    bgPanel: f(0.04),
    bgRaised: f(0.07),
    bgActive: f(0.1),
    border: f(0.1),
    borderStrong: f(0.16),
    light: luminanceHex(base) > 0.5
  }
}

function deriveFromText(text: string, bg: string): Pick<ThemePreset, 'textPrimary' | 'textSecondary' | 'textMuted'> {
  return {
    textPrimary: ensureContrast(text, bg),
    textSecondary: ensureContrast(mixHex(text, bg, 0.28), bg),
    textMuted: ensureContrast(mixHex(text, bg, 0.42), bg)
  }
}

/** 组合基色 + 用户覆盖，得到实际生效的主题 */
export function buildTheme(base: ThemePreset, overrides: ThemeOverrides): ThemePreset {
  let t: ThemePreset = { ...base }
  if (overrides.bg) t = { ...t, ...deriveFromBg(overrides.bg) }
  if (overrides.text) t = { ...t, ...deriveFromText(overrides.text, t.bgApp) }
  if (overrides.accent) t = { ...t, accent: overrides.accent, accentDim: accentDimFrom(overrides.accent) }
  return t
}

/** 将主题应用到根节点（覆盖 CSS 变量 + 切换 Tailwind dark class + color-scheme） */
export function applyTheme(t: ThemePreset): void {
  const root = document.documentElement
  const set = (key: string, value: string): void => root.style.setProperty(key, value)
  set('--accent', t.accent)
  set('--accent-dim', t.accentDim)
  set('--bg-app', t.bgApp)
  set('--bg-panel', t.bgPanel)
  set('--bg-raised', t.bgRaised)
  set('--bg-active', t.bgActive)
  set('--border', t.border)
  set('--border-strong', t.borderStrong)
  set('--text-primary', t.textPrimary)
  set('--text-secondary', t.textSecondary)
  set('--text-muted', t.textMuted)
  root.style.colorScheme = t.light ? 'light' : 'dark'
  root.classList.toggle('dark', !t.light)
}

export function getTheme(id: string): ThemePreset {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
