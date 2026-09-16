import { create } from 'zustand'
import {
  DEFAULT_THEME_MODE,
  MODE_LEGACY_PRESET_ID,
  resolveThemeSettings,
  sanitizeThemeOverrides,
  type PersistedTheme,
  type ThemeMode,
  type ThemeOverrides
} from '@shared/themePreferences'
import { applyThemeToRoot, subscribeSystemTheme } from '../theme/applyTheme'
import { systemPrefersDark } from '../theme/systemTheme'
import { resolveTheme, type ResolvedTheme } from '../theme/tokens'

/**
 * 主题状态机。
 *
 * 不变量：
 * 1. `mode` 永远保存用户的选择（system / light / dark），
 *    系统主题变化只会改变 `resolved`，不会把 `mode` 改写成固定模式。
 * 2. `overrides` 只保存用户显式自定义的项；「一键恢复默认」清空它。
 * 3. 任何会改变最终外观的操作，都同时更新 DOM 变量与标题栏 overlay。
 * 4. 系统主题订阅始终只有一个，重复 hydrate 不会累积监听器。
 */

/** 系统主题订阅句柄，保证全局唯一 */
let unsubscribeSystem: (() => void) | null = null

/** 由当前 mode 与覆盖解析出实际生效的令牌集 */
function resolveCurrent(mode: ThemeMode, overrides: ThemeOverrides): ResolvedTheme {
  return resolveTheme({ mode, overrides })
}

/** 把令牌推送到 DOM 与 Electron 标题栏 */
function pushTheme(theme: ResolvedTheme): void {
  applyThemeToRoot(theme)
  try {
    void window.agent?.window.setTitleBarOverlay({
      color: theme.color.surface.app,
      symbolColor: theme.color.text.primary
    })
  } catch {
    /* 非 Electron 环境或 IPC 尚未就绪时忽略 */
  }
}

/**
 * 根据模式维护系统主题订阅。
 * mode 为 system 时订阅系统变化并实时重算；否则解除订阅。
 */
function syncSystemSubscription(
  mode: ThemeMode,
  get: () => ThemeState,
  set: (partial: Partial<ThemeState>) => void
): void {
  unsubscribeSystem?.()
  unsubscribeSystem = null
  if (mode !== 'system') return

  unsubscribeSystem = subscribeSystemTheme(() => {
    // 守卫：只有仍处于跟随系统时才响应
    if (get().mode !== 'system') return
    const theme = resolveCurrent('system', get().overrides)
    pushTheme(theme)
    set({ resolved: theme })
  })
}

interface ThemeState {
  /** 用户选择的主题模式 */
  mode: ThemeMode
  overrides: ThemeOverrides
  /** 当前实际生效的令牌集 */
  resolved: ResolvedTheme
  hydrated: boolean

  /** @deprecated 兼容旧组件读取的 presetId 镜像 */
  presetId: string

  hydrate: () => Promise<void>
  setMode: (mode: ThemeMode) => void
  setBg: (hex: string) => void
  setText: (hex: string) => void
  setAccent: (hex: string) => void
  resetOverrides: () => void
  /** @deprecated 旧 API：按预设 id 切换，内部转换为模式 */
  setPreset: (id: string) => void
}

// 首帧：在 React 挂载前先用「跟随系统」应用一次，避免主题闪烁
const initialResolved = resolveCurrent(DEFAULT_THEME_MODE, {})
pushTheme(initialResolved)

export const useThemeStore = create<ThemeState>((set, get) => {
  const persist = (mode: ThemeMode, overrides: ThemeOverrides): void => {
    const payload: PersistedTheme = {
      mode,
      overrides,
      presetId: MODE_LEGACY_PRESET_ID[mode]
    }
    try {
      void window.agent?.settings.setTheme(payload)
    } catch {
      /* 持久化失败不影响当前会话的主题表现 */
    }
  }

  /** 统一的应用 + 落库 + 状态更新入口 */
  const commit = (mode: ThemeMode, overrides: ThemeOverrides): void => {
    const theme = resolveCurrent(mode, overrides)
    pushTheme(theme)
    set({
      mode,
      overrides,
      resolved: theme,
      presetId: MODE_LEGACY_PRESET_ID[mode]
    })
    syncSystemSubscription(mode, get, set)
    persist(mode, overrides)
  }

  return {
    mode: DEFAULT_THEME_MODE,
    overrides: {},
    resolved: initialResolved,
    hydrated: false,
    presetId: MODE_LEGACY_PRESET_ID[DEFAULT_THEME_MODE],

    hydrate: async () => {
      try {
        const result = await window.agent?.settings.getTheme()
        if (result?.ok) {
          // 正常情况下主进程已经完成迁移；这里再走一次 resolveThemeSettings，
          // 保证即使读到旧结构（presetId + overrides）或自定义来源也能正确解析。
          const migrated = resolveThemeSettings(result.data)
          const mode = migrated.mode ?? DEFAULT_THEME_MODE
          const overrides = sanitizeThemeOverrides(migrated.overrides) ?? {}
          const theme = resolveCurrent(mode, overrides)
          pushTheme(theme)
          set({
            mode,
            overrides,
            resolved: theme,
            presetId: MODE_LEGACY_PRESET_ID[mode],
            hydrated: true
          })
          syncSystemSubscription(mode, get, set)
          return
        }
      } catch {
        /* 读取失败时保留首帧的跟随系统结果 */
      }
      // 即使没有持久化数据也要建立系统订阅
      set({ hydrated: true })
      syncSystemSubscription(get().mode, get, set)
    },

    setMode: (mode) => {
      // 切换模式视为「重新选择一套基线」，清空自定义覆盖
      commit(mode, {})
    },

    setBg: (hex) => {
      const overrides = sanitizeThemeOverrides({ ...get().overrides, bg: hex })
      if (!overrides) return
      commit(get().mode, overrides)
    },

    setText: (hex) => {
      const overrides = sanitizeThemeOverrides({ ...get().overrides, text: hex })
      if (!overrides) return
      commit(get().mode, overrides)
    },

    setAccent: (hex) => {
      const overrides = sanitizeThemeOverrides({ ...get().overrides, accent: hex })
      if (!overrides) return
      commit(get().mode, overrides)
    },

    resetOverrides: () => {
      commit(get().mode, {})
    },

    setPreset: (id) => {
      // 旧组件传进来的是 presetId；daylight 视为浅色，其余视为深色
      const mode: ThemeMode = id === 'daylight' ? 'light' : 'dark'
      commit(mode, {})
    }
  }
})

/** 读取当前令牌集（供未使用 hook 的场景） */
export function getResolvedTheme(): ResolvedTheme {
  return useThemeStore.getState().resolved
}

/**
 * 订阅令牌集。组件用它替代旧的 getTheme(presetId) 读取方式，
 * 保证系统主题变化时能够重新渲染。
 */
export function useResolvedTheme(): ResolvedTheme {
  return useThemeStore((s) => s.resolved)
}

/** 测试辅助：清理全局系统主题订阅，避免用例之间互相影响 */
export function disposeThemeSubscription(): void {
  unsubscribeSystem?.()
  unsubscribeSystem = null
}

/** 测试辅助：直接以给定模式覆盖解析一次（不落库） */
export function previewMode(mode: ThemeMode, overrides: ThemeOverrides = {}): ResolvedTheme {
  return resolveCurrent(mode, overrides)
}

/** 供调试：当前是否正在跟随系统 */
export function isFollowingSystem(): boolean {
  return useThemeStore.getState().mode === 'system'
}

/** 供调试：系统当前偏好 */
export function currentSystemDark(): boolean {
  return systemPrefersDark()
}
