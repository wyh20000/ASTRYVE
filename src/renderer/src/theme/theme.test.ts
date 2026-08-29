import { describe, it, expect } from 'vitest'
import {
  normalizeHex,
  mixHex,
  accentDimFrom,
  buildTheme,
  getTheme,
  DEFAULT_THEME_ID,
  THEMES
} from './theme'

describe('normalizeHex', () => {
  it('接受 #rgb / #rrggbb / 不带# / 大写 形式', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc')
    expect(normalizeHex('#5271ff')).toBe('#5271ff')
    expect(normalizeHex('5271ff')).toBe('#5271ff')
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc')
  })

  it('非法输入返回 null', () => {
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex('#ggg')).toBeNull()
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex('red')).toBeNull()
  })
})

describe('mixHex', () => {
  it('按比例混合两个颜色', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
  })
})

describe('accentDimFrom', () => {
  it('派生更暗的强调色（合法 6 位 hex，且不等于原色）', () => {
    const dim = accentDimFrom('#5271ff')
    expect(dim).toMatch(/^#[0-9a-f]{6}$/)
    expect(dim).not.toBe('#5271ff')
  })

  it('非法输入回退默认 dim 色', () => {
    expect(accentDimFrom('not-a-color')).toBe('#33427f')
  })
})

describe('buildTheme', () => {
  const base = getTheme('midnight')

  it('无覆盖时返回原主题', () => {
    expect(buildTheme(base, {})).toEqual(base)
  })

  it('覆盖背景色时派生更亮的面板层级', () => {
    const t = buildTheme(base, { bg: '#000000' })
    expect(t.bgApp).toBe('#000000')
    expect(t.bgPanel).not.toBe('#000000')
  })

  it('覆盖强调色时派生 accentDim', () => {
    const t = buildTheme(base, { accent: '#ff0000' })
    expect(t.accent).toBe('#ff0000')
    expect(t.accentDim).not.toBe(base.accentDim)
  })

  it('覆盖文字色时派生次要/弱文本', () => {
    const t = buildTheme(base, { text: '#ffffff' })
    expect(t.textPrimary).toBe('#ffffff')
    expect(t.textSecondary).not.toBe('#ffffff')
  })
})

describe('主题预设', () => {
  it('至少包含一个主题且默认主题存在', () => {
    expect(THEMES.length).toBeGreaterThan(0)
    expect(getTheme(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID)
  })

  it('未知主题 id 回退到第一个主题', () => {
    expect(getTheme('not-exist').id).toBe(THEMES[0].id)
  })
})
