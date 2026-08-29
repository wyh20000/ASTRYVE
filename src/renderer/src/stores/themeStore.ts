import { create } from 'zustand'
import {
  applyTheme,
  getTheme,
  buildTheme,
  DEFAULT_THEME_ID,
  normalizeHex,
  type ThemePreset,
  type ThemeOverrides
} from '../theme/theme'
import type { PersistedTheme } from '@shared/types'

function pushTitleBar(t: ThemePreset): void {
  try {
    void window.agent.window.setTitleBarOverlay({ color: t.bgApp, symbolColor: t.textPrimary })
  } catch {
    /* ignore */
  }
}

function apply(presetId: string, overrides: ThemeOverrides): void {
  const theme = buildTheme(getTheme(presetId), overrides)
  applyTheme(theme)
  pushTitleBar(theme)
}

interface ThemeState {
  presetId: string
  overrides: ThemeOverrides
  hydrated: boolean
  hydrate: () => Promise<void>
  setPreset: (id: string) => void
  setBg: (hex: string) => void
  setText: (hex: string) => void
  setAccent: (hex: string) => void
  resetOverrides: () => void
}

// 先用默认主题（避免首帧空白），随后 hydrate 从主进程加载已保存主题
apply(DEFAULT_THEME_ID, {})

export const useThemeStore = create<ThemeState>((set, get) => {
  const persist = (presetId: string, overrides: ThemeOverrides): void => {
    const payload: PersistedTheme = { presetId, overrides }
    void window.agent.settings.setTheme(payload)
  }
  return {
    presetId: DEFAULT_THEME_ID,
    overrides: {},
    hydrated: false,
    hydrate: async () => {
      try {
        const r = await window.agent.settings.getTheme()
        if (r.ok) {
          const presetId = r.data.presetId || DEFAULT_THEME_ID
          const overrides = r.data.overrides ?? {}
          apply(presetId, overrides)
          set({ presetId, overrides, hydrated: true })
        }
      } catch {
        /* ignore */
      }
    },
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
      const p = get().presetId
      apply(p, {})
      set({ overrides: {} })
      persist(p, {})
    }
  }
})
