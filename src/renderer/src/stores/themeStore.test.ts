import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersistedTheme } from '@shared/themePreferences'

/**
 * themeStore 的测试要点（对应设计文档 5.1 / 5.4）：
 * 1. system 模式下系统主题变化只更新实际外观，不改写用户选择；
 * 2. 切换模式、修改颜色、恢复默认都会即时生效并落库；
 * 3. 旧 presetId 结构能正确迁移成模式；
 * 4. 全局只保留一个系统订阅，不累积监听器。
 */

type Listener = (event: { matches: boolean }) => void

interface FakeEnv {
  root: {
    style: { props: Record<string, string>; colorScheme: string }
    classes: Set<string>
    dataset: Record<string, string>
  }
  setDark: (value: boolean) => void
  listenerCount: () => number
  savedThemes: PersistedTheme[]
  titleBarColors: string[]
}

function createEnv(options: { systemDark: boolean; stored?: unknown; ok?: boolean }): FakeEnv {
  let dark = options.systemDark
  const listeners = new Set<Listener>()
  const savedThemes: PersistedTheme[] = []
  const titleBarColors: string[] = []

  const root = {
    style: {
      props: {} as Record<string, string>,
      colorScheme: '',
      setProperty(this: { props: Record<string, string> }, name: string, value: string) {
        this.props[name] = value
      }
    },
    classes: new Set<string>(),
    dataset: {} as Record<string, string>
  }
  // classList 需要访问 root.classes
  Object.assign(root, {
    classList: {
      toggle: (token: string, force?: boolean) => {
        const on = force ?? !root.classes.has(token)
        if (on) root.classes.add(token)
        else root.classes.delete(token)
      }
    }
  })

  const query = {
    get matches() {
      return dark
    },
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener)
  }

  vi.stubGlobal('document', { documentElement: root })
  vi.stubGlobal('window', {
    matchMedia: () => query,
    agent: {
      settings: {
        getTheme: async () => ({ ok: options.ok ?? true, data: options.stored }),
        setTheme: async (payload: PersistedTheme) => {
          savedThemes.push(payload)
          return { ok: true, data: payload }
        }
      },
      window: {
        setTitleBarOverlay: async (value: { color: string }) => {
          titleBarColors.push(value.color)
          return { ok: true }
        }
      }
    }
  })

  return {
    root,
    setDark: (value: boolean) => {
      dark = value
      for (const listener of listeners) listener({ matches: value })
    },
    listenerCount: () => listeners.size,
    savedThemes,
    titleBarColors
  }
}

async function loadStore(): Promise<typeof import('./themeStore')> {
  vi.resetModules()
  return import('./themeStore')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(async () => {
  const mod = await import('./themeStore')
  mod.disposeThemeSubscription()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('首帧与默认值', () => {
  it('默认模式为跟随系统', async () => {
    createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    expect(useThemeStore.getState().mode).toBe('system')
    expect(useThemeStore.getState().overrides).toEqual({})
  })

  it('首帧跟随系统明暗解析（系统深色 → 深色界面）', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    expect(useThemeStore.getState().resolved.isDark).toBe(true)
    expect(env.root.classes.has('dark')).toBe(true)
    expect(env.root.style.props['--surface-app']).toBe('#111315')
  })

  it('系统为浅色时首帧即为浅色，写入浅色表面值', async () => {
    const env = createEnv({ systemDark: false })
    const { useThemeStore } = await loadStore()
    expect(useThemeStore.getState().resolved.isDark).toBe(false)
    expect(env.root.classes.has('dark')).toBe(false)
    expect(env.root.style.props['--surface-app']).toBe('#f7f8fa')
  })
})

describe('hydrate - 读取与迁移', () => {
  it('读取新结构设置并应用', async () => {
    createEnv({
      systemDark: true,
      stored: { version: 2, mode: 'light', overrides: { accent: '#ff0000' } }
    })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()

    const state = useThemeStore.getState()
    expect(state.mode).toBe('light')
    expect(state.resolved.isDark).toBe(false)
    expect(state.resolved.color.accent.primary).toBe('#ff0000')
    expect(state.hydrated).toBe(true)
  })

  it('读取旧 presetId 结构时迁移为对应模式', async () => {
    createEnv({ systemDark: true, stored: { presetId: 'daylight', overrides: {} } })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()

    expect(useThemeStore.getState().mode).toBe('light')
    expect(useThemeStore.getState().resolved.isDark).toBe(false)
  })

  it('未知旧预设回退深色', async () => {
    createEnv({ systemDark: false, stored: { presetId: 'midnight', overrides: {} } })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()
    expect(useThemeStore.getState().mode).toBe('dark')
  })

  it('读取失败时保留跟随系统且不抛错', async () => {
    createEnv({ systemDark: false, ok: false })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()
    expect(useThemeStore.getState().mode).toBe('system')
    expect(useThemeStore.getState().resolved.isDark).toBe(false)
    expect(useThemeStore.getState().hydrated).toBe(true)
  })

  it('非法覆盖在 hydrate 时被清洗', async () => {
    createEnv({
      systemDark: true,
      stored: { version: 2, mode: 'dark', overrides: { bg: 'not-a-color', accent: '#00ff00' } }
    })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()
    expect(useThemeStore.getState().overrides).toEqual({ accent: '#00ff00' })
  })
})

describe('跟随系统 - 实时响应且不改写用户选择', () => {
  it('系统主题变化时更新实际外观', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()
    expect(useThemeStore.getState().resolved.isDark).toBe(true)

    env.setDark(false)
    expect(useThemeStore.getState().resolved.isDark).toBe(false)
    expect(env.root.classes.has('dark')).toBe(false)
    expect(env.root.style.props['--surface-app']).toBe('#f7f8fa')
  })

  it('系统主题变化不会把 mode 改写成固定模式', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()

    env.setDark(false)
    env.setDark(true)

    const state = useThemeStore.getState()
    expect(state.mode).toBe('system')
    expect(state.presetId).toBe('midnight')
  })

  it('非 system 模式不订阅系统变化', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()
    expect(env.listenerCount()).toBe(1)

    useThemeStore.getState().setMode('light')
    expect(env.listenerCount()).toBe(0)

    // 系统切换不应影响已固定的浅色
    env.setDark(true)
    expect(useThemeStore.getState().resolved.isDark).toBe(false)
  })

  it('切回 system 后重新订阅并能再次跟随', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()

    useThemeStore.getState().setMode('dark')
    expect(env.listenerCount()).toBe(0)

    env.setDark(false)
    useThemeStore.getState().setMode('system')
    expect(env.listenerCount()).toBe(1)
    expect(useThemeStore.getState().resolved.isDark).toBe(false)
  })

  it('重复 hydrate 不会累积系统订阅', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()
    await useThemeStore.getState().hydrate()
    await useThemeStore.getState().hydrate()
    expect(env.listenerCount()).toBe(1)
  })
})

describe('模式切换与自定义', () => {
  it('setMode 即时生效并落库（含版本化字段）', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    useThemeStore.getState().setMode('light')

    expect(useThemeStore.getState().resolved.isDark).toBe(false)
    const saved = env.savedThemes.at(-1)
    expect(saved?.mode).toBe('light')
    expect(saved?.presetId).toBe('daylight')
    expect(saved?.overrides).toEqual({})
  })

  it('setMode 清空已有自定义覆盖', async () => {
    createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    useThemeStore.getState().setAccent('#ff0000')
    expect(useThemeStore.getState().overrides.accent).toBe('#ff0000')

    useThemeStore.getState().setMode('dark')
    expect(useThemeStore.getState().overrides).toEqual({})
  })

  it('setAccent 保留其他覆盖并立即生效', async () => {
    createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    useThemeStore.getState().setBg('#000000')
    useThemeStore.getState().setAccent('#ff0000')

    const state = useThemeStore.getState()
    expect(state.overrides).toEqual({ bg: '#000000', accent: '#ff0000' })
    expect(state.resolved.color.surface.app).toBe('#000000')
    expect(state.resolved.color.accent.primary).toBe('#ff0000')
  })

  it('非法颜色被忽略且不落库', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    useThemeStore.getState().setAccent('#00ff00')
    const before = env.savedThemes.length

    useThemeStore.getState().setAccent('not-a-color')
    expect(useThemeStore.getState().overrides.accent).toBe('#00ff00')
    expect(env.savedThemes.length).toBe(before)
  })

  it('resetOverrides 恢复基线但保留当前模式', async () => {
    createEnv({ systemDark: false })
    const { useThemeStore } = await loadStore()
    useThemeStore.getState().setMode('dark')
    useThemeStore.getState().setBg('#000000')
    useThemeStore.getState().resetOverrides()

    const state = useThemeStore.getState()
    expect(state.mode).toBe('dark')
    expect(state.overrides).toEqual({})
    expect(state.resolved.color.surface.app).toBe('#111315')
  })

  it('自定义背景会在跟随系统时自动改写实际明暗，避免不可读', async () => {
    createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    useThemeStore.getState().setMode('light')
    useThemeStore.getState().setBg('#000000')

    const state = useThemeStore.getState()
    expect(state.mode).toBe('light')
    expect(state.resolved.isDark).toBe(true)
    expect(state.resolved.color.text.primary).not.toBe('#000000')
  })
})

describe('旧 API 兼容', () => {
  it('setPreset(daylight) 等价于切换到浅色', async () => {
    createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    useThemeStore.getState().setPreset('daylight')
    expect(useThemeStore.getState().mode).toBe('light')
    expect(useThemeStore.getState().presetId).toBe('daylight')
  })

  it('setPreset(midnight) 等价于切换到深色', async () => {
    createEnv({ systemDark: false })
    const { useThemeStore } = await loadStore()
    useThemeStore.getState().setPreset('midnight')
    expect(useThemeStore.getState().mode).toBe('dark')
  })

  it('presetId 镜像始终与 mode 保持一致', async () => {
    createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    for (const [mode, expected] of [
      ['light', 'daylight'],
      ['dark', 'midnight'],
      ['system', 'midnight']
    ] as const) {
      useThemeStore.getState().setMode(mode)
      expect(useThemeStore.getState().presetId).toBe(expected)
    }
  })
})

describe('标题栏同步', () => {
  it('每次主题变化都把应用背景推送给 Electron 标题栏', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    useThemeStore.getState().setMode('light')

    expect(env.titleBarColors.at(-1)).toBe('#f7f8fa')
  })

  it('系统主题变化同样同步标题栏', async () => {
    const env = createEnv({ systemDark: true })
    const { useThemeStore } = await loadStore()
    await useThemeStore.getState().hydrate()
    const before = env.titleBarColors.length

    env.setDark(false)
    expect(env.titleBarColors.length).toBeGreaterThan(before)
    expect(env.titleBarColors.at(-1)).toBe('#f7f8fa')
  })

  it('缺少 Electron bridge 时不抛错', async () => {
    vi.stubGlobal('document', {
      documentElement: {
        style: { props: {}, setProperty() {} },
        classList: { toggle() {} },
        dataset: {}
      }
    })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const { useThemeStore } = await loadStore()
    expect(() => useThemeStore.getState().setMode('dark')).not.toThrow()
  })
})
