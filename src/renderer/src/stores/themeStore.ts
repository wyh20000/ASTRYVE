import { create } from 'zustand'
import {
  THEMES,
  applyTheme,
  getTheme,
  buildTheme,
  DEFAULT_THEME_ID,
  normalizeHex,
  type ThemePreset,
  type ThemeOverrides
} from '../theme/theme'

const PRESET_KEY = 'ai-agent:theme'
const OVERRIDES_KEY = 'ai-agent:theme-overrides'

function readPreset(): string {
  try {
    const saved = localStorage.getItem(PRESET_KEY)
    if (saved && THEMES.some((t) => t.id === saved)) return saved
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME_ID
}

function readOverrides(): ThemeOverrides {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as ThemeOverrides
    const out: ThemeOverrides = {}
    if (o.bg) out.bg = normalizeHex(o.bg) ?? undefined
    if (o.text) out.text = normalizeHex(o.text) ?? undefined
    if (o.accent) out.accent = normalizeHex(o.accent) ?? undefined
    return out
  } catch {
    return {}
  }
}

function persist(presetId: string, overrides: ThemeOverrides): void {
  try {
    localStorage.setItem(PRESET_KEY, presetId)
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    /* ignore */
  }
}

function pushTitleBar(t: ThemePreset): void {
  try {
    void window.agent.window.setTitleBarOverlay({ color: t.bgApp, symbolColor: t.textPrimary })
  } catch {
    /* ignore */
  }
}

export const STORAGE_THEME_KEY = PRESET_KEY

interface ThemeState {
  presetId: string
  overrides: ThemeOverrides
  setPreset: (id: string) => void
  setBg: (hex: string) => void
  setText: (hex: string) => void
  setAccent: (hex: string) => void
  resetOverrides: () => void
}

const initialPreset = readPreset()
const initialOverrides = readOverrides()
const initialTheme = buildTheme(getTheme(initialPreset), initialOverrides)
applyTheme(initialTheme)
pushTitleBar(initialTheme)

export const useThemeStore = create<ThemeState>((set, get) => {
  const apply = (presetId: string, overrides: ThemeOverrides): void => {
    const theme = buildTheme(getTheme(presetId), overrides)
    applyTheme(theme)
    pushTitleBar(theme)
  }
  return {
    presetId: initialPreset,
    overrides: initialOverrides,
    setPreset: (id) => {
      apply(id, {})
      set({ presetId: id, overrides: {} })
      persist(id, {})
    },
    setBg: (hex) => {
      const n = normalizeHex(hex)
      if (!n) return
      const overrides = { ...get().overrides, bg: n }
      apply(get().presetId, overrides)
      set({ overrides })
      persist(get().presetId, overrides)
    },
    setText: (hex) => {
      const n = normalizeHex(hex)
      if (!n) return
      const overrides = { ...get().overrides, text: n }
      apply(get().presetId, overrides)
      set({ overrides })
      persist(get().presetId, overrides)
    },
    setAccent: (hex) => {
      const n = normalizeHex(hex)
      if (!n) return
      const overrides = { ...get().overrides, accent: n }
      apply(get().presetId, overrides)
      set({ overrides })
      persist(get().presetId, overrides)
    },
    resetOverrides: () => {
      apply(get().presetId, {})
      set({ overrides: {} })
      persist(get().presetId, {})
    }
  }
})