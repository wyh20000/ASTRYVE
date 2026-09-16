/**
 * 首帧颜色常量与令牌的一致性约束。
 *
 * 背景：`BrowserWindow.backgroundColor` 与 `titleBarOverlay` 必须在渲染进程
 * 应用主题之前给出颜色，因此在 shared 层保留了两个字面量。
 * 这类「两处相同取值」最容易随时间漂移，所以用测试锁住。
 */
import { describe, expect, it } from 'vitest'
import { FIRST_PAINT_BACKGROUND, FIRST_PAINT_SYMBOL } from './themePaint'
import { resolveTheme } from '../renderer/src/theme/tokens'

describe('首帧颜色常量', () => {
  it('是合法 hex', () => {
    expect(FIRST_PAINT_BACKGROUND).toMatch(/^#[0-9a-f]{6}$/)
    expect(FIRST_PAINT_SYMBOL).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('与深色令牌的应用背景一致（窗口首帧不闪别的底色）', () => {
    const dark = resolveTheme({ mode: 'dark', isDark: true })
    expect(FIRST_PAINT_BACKGROUND).toBe(dark.color.surface.app)
  })

  it('与深色令牌的主文字色一致（标题栏符号颜色正确）', () => {
    const dark = resolveTheme({ mode: 'dark', isDark: true })
    expect(FIRST_PAINT_SYMBOL).toBe(dark.color.text.primary)
  })

  it('不再使用旧版偏蓝黑底色', () => {
    // 旧实现写死 #0a0e17（午夜蓝），与新的中性冷灰基线不一致
    expect(FIRST_PAINT_BACKGROUND).not.toBe('#0a0e17')
  })
})
