import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_MODE,
  THEME_SCHEMA_VERSION,
  isCurrentThemeSchema,
  isThemeMode,
  modeFromLegacyPresetId,
  normalizeHexColor,
  normalizeUiFontSize,
  resolveThemeSettings,
  sanitizeThemeOverrides
} from './themePreferences'

describe('normalizeHexColor', () => {
  it('接受 #rgb / #rrggbb / 无 # / 大写形式', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc')
    expect(normalizeHexColor('#4D6BFE')).toBe('#4d6bfe')
    expect(normalizeHexColor('4d6bfe')).toBe('#4d6bfe')
  })

  it('非法输入返回 null', () => {
    for (const bad of ['#12345', '#ggg', '', 'red', null, undefined, 42, {}]) {
      expect(normalizeHexColor(bad)).toBeNull()
    }
  })
})

describe('sanitizeThemeOverrides', () => {
  it('丢弃非法颜色，只保留合法项', () => {
    expect(sanitizeThemeOverrides({ bg: '#112233', text: 'nope', accent: '#abcdef' })).toEqual({
      bg: '#112233',
      accent: '#abcdef'
    })
  })

  it('没有任何有效项时返回 undefined', () => {
    expect(sanitizeThemeOverrides({ bg: 'not-a-color' })).toBeUndefined()
    expect(sanitizeThemeOverrides({ bg: '#12345' })).toBeUndefined()
    expect(sanitizeThemeOverrides(null)).toBeUndefined()
    expect(sanitizeThemeOverrides('string')).toBeUndefined()
    expect(sanitizeThemeOverrides({})).toBeUndefined()
  })

  it('三位简写 hex 视为合法颜色（bad 即 #bbaadd）', () => {
    expect(sanitizeThemeOverrides({ bg: 'bad' })).toEqual({ bg: '#bbaadd' })
  })

  it('字号被夹取到合法范围', () => {
    expect(sanitizeThemeOverrides({ uiFontSize: 99 })?.uiFontSize).toBe(16)
    expect(sanitizeThemeOverrides({ uiFontSize: 1 })?.uiFontSize).toBe(12)
  })
})

describe('normalizeUiFontSize', () => {
  it('非法值回退到 14，超范围夹取', () => {
    expect(normalizeUiFontSize(undefined)).toBe(14)
    expect(normalizeUiFontSize('abc')).toBe(14)
    expect(normalizeUiFontSize(15)).toBe(15)
    expect(normalizeUiFontSize(100)).toBe(16)
    expect(normalizeUiFontSize(0)).toBe(12)
  })
})

describe('modeFromLegacyPresetId', () => {
  it('深色预设映射为 dark，daylight 映射为 light', () => {
    expect(modeFromLegacyPresetId('midnight')).toBe('dark')
    expect(modeFromLegacyPresetId('obsidian')).toBe('dark')
    expect(modeFromLegacyPresetId('forest')).toBe('dark')
    expect(modeFromLegacyPresetId('amber')).toBe('dark')
    expect(modeFromLegacyPresetId('daylight')).toBe('light')
  })

  it('未知或缺失时回退 dark，匹配旧版默认午夜蓝', () => {
    expect(modeFromLegacyPresetId('not-a-preset')).toBe('dark')
    expect(modeFromLegacyPresetId(undefined)).toBe('dark')
    expect(modeFromLegacyPresetId(123)).toBe('dark')
  })
})

describe('resolveThemeSettings - 旧设置迁移', () => {
  it('新安装（无任何设置）默认跟随系统且无覆盖', () => {
    const result = resolveThemeSettings(undefined)
    expect(result.mode).toBe(DEFAULT_THEME_MODE)
    expect(result.mode).toBe('system')
    expect(result.overrides).toEqual({})
    expect(result.version).toBe(THEME_SCHEMA_VERSION)
  })

  it('顶层直接是主题对象的历史形态可被迁移', () => {
    const result = resolveThemeSettings({ presetId: 'daylight', overrides: {} })
    expect(result.mode).toBe('light')
  })

  it('{ theme: ... } 包裹结构可被迁移', () => {
    const result = resolveThemeSettings({ theme: { presetId: 'obsidian', overrides: {} } })
    expect(result.mode).toBe('dark')
  })

  it('旧预设的强调色与背景基调被保留为覆盖，避免升级后换肤', () => {
    const result = resolveThemeSettings({ presetId: 'forest', overrides: {} })
    expect(result.mode).toBe('dark')
    expect(result.overrides.bg).toBe('#0a0e17')
    expect(result.overrides.accent).toBe('#3fb950')
  })

  it('daylight 的浅色背景与强调色同样被保留', () => {
    const result = resolveThemeSettings({ presetId: 'daylight', overrides: {} })
    expect(result.mode).toBe('light')
    expect(result.overrides.bg).toBe('#f6f7f9')
    expect(result.overrides.accent).toBe('#2563eb')
  })

  it('用户已有自定义覆盖时优先于旧预设种子', () => {
    const result = resolveThemeSettings({
      presetId: 'midnight',
      overrides: { accent: '#ff0000' }
    })
    expect(result.overrides).toEqual({ accent: '#ff0000' })
  })

  it('已有的新模式设置保持 mode 不被 presetId 镜像改写', () => {
    const result = resolveThemeSettings({
      version: 2,
      mode: 'system',
      overrides: { accent: '#4d6bfe' },
      presetId: 'daylight'
    })
    expect(result.mode).toBe('system')
    expect(result.overrides).toEqual({ accent: '#4d6bfe' })
  })

  it('非法覆盖在迁移中被清洗，不影响启动', () => {
    const result = resolveThemeSettings({
      presetId: 'midnight',
      overrides: { bg: 'javascript:alert(1)', accent: '#00ff00' }
    })
    expect(result.overrides).toEqual({ accent: '#00ff00' })
  })

  it('未知预设不会带出任何颜色种子', () => {
    const result = resolveThemeSettings({ presetId: 'unknown-preset', overrides: {} })
    expect(result.mode).toBe('dark')
    expect(result.overrides).toEqual({})
  })

  it('各种垃圾输入都不抛错，一律回退系统主题', () => {
    for (const bad of [null, undefined, 0, '', 'abc', [], true, { theme: 'x' }]) {
      const result = resolveThemeSettings(bad)
      expect(result.mode).toBe('system')
      expect(result.overrides).toEqual({})
    }
  })
})

describe('isCurrentThemeSchema', () => {
  it('只有 version 与 mode 同时正确才算当前结构', () => {
    expect(isCurrentThemeSchema({ version: 2, mode: 'system', overrides: {} })).toBe(true)
    expect(isCurrentThemeSchema({ theme: { version: 2, mode: 'dark', overrides: {} } })).toBe(true)
    expect(isCurrentThemeSchema({ version: 1, mode: 'dark' })).toBe(false)
    expect(isCurrentThemeSchema({ presetId: 'midnight', overrides: {} })).toBe(false)
    expect(isCurrentThemeSchema(undefined)).toBe(false)
  })
})

describe('isThemeMode', () => {
  it('只接受三个合法模式', () => {
    expect(isThemeMode('system')).toBe(true)
    expect(isThemeMode('light')).toBe(true)
    expect(isThemeMode('dark')).toBe(true)
    expect(isThemeMode('auto')).toBe(false)
    expect(isThemeMode(undefined)).toBe(false)
  })
})
