import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveTheme } from './tokens'
import { THEME_VAR_NAMES, applyResolvedTheme, applyThemeToRoot, toCssVariables } from './applyTheme'
import { isSystemThemeSupported, subscribeSystemTheme, systemPrefersDark } from './systemTheme'

const DARK = resolveTheme({ mode: 'dark', isDark: true })
const LIGHT = resolveTheme({ mode: 'light', isDark: false })

/* ---------------- document 假实现 ---------------- */

interface FakeRoot {
  style: {
    props: Record<string, string>
    colorScheme: string
    setProperty: (name: string, value: string) => void
  }
  classes: Set<string>
  dataset: Record<string, string>
  classList: { toggle: (token: string, force?: boolean) => void }
}

function createFakeDocument(): { root: FakeRoot } {
  const root: FakeRoot = {
    style: {
      props: {},
      colorScheme: '',
      setProperty(name: string, value: string) {
        this.props[name] = value
      }
    },
    classes: new Set<string>(['dark']),
    dataset: {},
    classList: {
      toggle(token: string, force?: boolean) {
        const on = force ?? !root.classes.has(token)
        if (on) root.classes.add(token)
        else root.classes.delete(token)
      }
    }
  }
  vi.stubGlobal('document', { documentElement: root })
  return { root }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('toCssVariables', () => {
  it('导出全部语义令牌变量', () => {
    const vars = toCssVariables(DARK)
    for (const name of Object.values(THEME_VAR_NAMES)) {
      expect(vars[name], `缺少变量 ${name}`).toBeTruthy()
    }
  })

  it('旧变量别名指向新语义令牌，保证未迁移组件不回归', () => {
    const vars = toCssVariables(DARK)
    expect(vars['--bg-app']).toBe(DARK.color.surface.app)
    expect(vars['--bg-panel']).toBe(DARK.color.surface.sidebar)
    expect(vars['--bg-raised']).toBe(DARK.color.surface.raised)
    expect(vars['--bg-active']).toBe(DARK.color.surface.active)
    expect(vars['--border']).toBe(DARK.color.border.default)
    expect(vars['--text-primary']).toBe(DARK.color.text.primary)
    expect(vars['--ok']).toBe(DARK.color.status.success)
    expect(vars['--warn']).toBe(DARK.color.status.warning)
    expect(vars['--err']).toBe(DARK.color.status.error)
  })

  it('字号与字体变量带单位且符合规范', () => {
    const vars = toCssVariables(DARK)
    expect(vars['--font-size-base']).toBe('14px')
    expect(vars['--font-sans']).toContain('Microsoft YaHei')
    expect(vars['--font-mono']).toContain('JetBrains Mono')
    expect(vars['--radius-md']).toBe('6px')
  })

  it('深浅色产出不同的表面值', () => {
    expect(toCssVariables(DARK)['--surface-app']).not.toBe(toCssVariables(LIGHT)['--surface-app'])
  })
})

describe('applyThemeToRoot', () => {
  it('把变量写入根节点并切换 color-scheme 与 dark class', () => {
    const { root } = createFakeDocument()
    applyThemeToRoot(DARK)

    expect(root.style.props['--surface-app']).toBe(DARK.color.surface.app)
    expect(root.style.props['--bg-app']).toBe(DARK.color.surface.app)
    expect(root.style.colorScheme).toBe('dark')
    expect(root.classes.has('dark')).toBe(true)
    expect(root.dataset.themeMode).toBe('dark')
    expect(root.dataset.themeResolved).toBe('dark')
  })

  it('浅色主题移除 dark class 并设置 light color-scheme', () => {
    const { root } = createFakeDocument()
    applyThemeToRoot(LIGHT)

    expect(root.classes.has('dark')).toBe(false)
    expect(root.style.colorScheme).toBe('light')
    expect(root.dataset.themeResolved).toBe('light')
  })

  it('跟随系统时记录 mode=system 但 resolved 反映真实明暗', () => {
    const { root } = createFakeDocument()
    applyThemeToRoot(resolveTheme({ mode: 'system', isDark: false }))

    expect(root.dataset.themeMode).toBe('system')
    expect(root.dataset.themeResolved).toBe('light')
    expect(root.classes.has('dark')).toBe(false)
  })

  it('applyResolvedTheme 返回传入的主题（便于链式使用）', () => {
    createFakeDocument()
    expect(applyResolvedTheme(DARK)).toBe(DARK)
  })

  it('没有 document 时安全返回（node 环境）', () => {
    vi.stubGlobal('document', undefined)
    expect(() => applyThemeToRoot(DARK)).not.toThrow()
  })
})

/* ---------------- 系统主题 ---------------- */

type Listener = (event: { matches: boolean }) => void

function stubMatchMedia(initialDark: boolean): {
  setDark: (value: boolean) => void
  listenerCount: () => number
} {
  let dark = initialDark
  const listeners = new Set<Listener>()
  const query = {
    get matches() {
      return dark
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener)
  }
  vi.stubGlobal('window', { matchMedia: () => query })
  return {
    setDark: (value: boolean) => {
      dark = value
      for (const listener of listeners) listener({ matches: value })
    },
    listenerCount: () => listeners.size
  }
}

describe('系统主题读取', () => {
  it('读取 matchMedia 的当前结果', () => {
    stubMatchMedia(true)
    expect(systemPrefersDark()).toBe(true)
    stubMatchMedia(false)
    expect(systemPrefersDark()).toBe(false)
  })

  it('无 matchMedia 时回退深色且标记为不支持', () => {
    vi.stubGlobal('window', {})
    expect(systemPrefersDark()).toBe(true)
    expect(isSystemThemeSupported()).toBe(false)
  })

  it('matchMedia 抛错时回退深色而不崩溃', () => {
    vi.stubGlobal('window', {
      matchMedia: () => {
        throw new Error('boom')
      }
    })
    expect(systemPrefersDark()).toBe(true)
  })

  it('支持 addEventListener 时能收到变化通知', () => {
    const media = stubMatchMedia(true)
    const seen: boolean[] = []
    const unsubscribe = subscribeSystemTheme((isDark) => seen.push(isDark))

    media.setDark(false)
    media.setDark(true)
    expect(seen).toEqual([false, true])

    unsubscribe()
    media.setDark(false)
    expect(seen).toEqual([false, true])
  })

  it('取消订阅后不再有监听器残留', () => {
    const media = stubMatchMedia(true)
    const unsubscribe = subscribeSystemTheme(() => {})
    expect(media.listenerCount()).toBe(1)
    unsubscribe()
    expect(media.listenerCount()).toBe(0)
  })

  it('仅支持 addListener 的旧环境也能工作', () => {
    let dark = true
    const listeners = new Set<Listener>()
    const query = {
      get matches() {
        return dark
      },
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener)
    }
    vi.stubGlobal('window', { matchMedia: () => query })

    const seen: boolean[] = []
    const unsubscribe = subscribeSystemTheme((value) => seen.push(value))
    dark = false
    for (const listener of listeners) listener({ matches: false })
    expect(seen).toEqual([false])

    unsubscribe()
    expect(listeners.size).toBe(0)
  })

  it('无 matchMedia 时返回空操作订阅', () => {
    vi.stubGlobal('window', {})
    const unsubscribe = subscribeSystemTheme(() => {
      throw new Error('不应被调用')
    })
    expect(() => unsubscribe()).not.toThrow()
  })
})

/* ---------------- 首帧行为 ---------------- */

describe('首帧防闪烁', () => {
  let root: FakeRoot

  beforeEach(() => {
    root = createFakeDocument().root
  })

  it('模块级初始化在 React 挂载前就已写入变量', async () => {
    // themeStore 在 import 时即应用一次主题（pushTheme）
    vi.resetModules()
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    await import('../stores/themeStore')

    expect(root.style.props['--surface-app']).toBeTruthy()
    expect(root.style.props['--font-size-base']).toBe('14px')
    expect(root.dataset.themeResolved).toBeTruthy()
  })
})
