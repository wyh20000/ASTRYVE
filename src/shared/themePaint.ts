/**
 * 首帧颜色常量（主进程与渲染进程共享）。
 *
 * 背景：`BrowserWindow.backgroundColor` 与 `titleBarOverlay` 必须在渲染进程
 * 应用主题**之前**就给出颜色，否则会先闪一下另一种底色。
 *
 * 这里放的是「深色基线」的应用背景与主文字色，必须与
 * `renderer/src/theme/tokens.ts` 中 DARK_BASE 的同名字段保持一致：
 * 令牌引擎直接引用本文件的常量，因此不存在两份值漂移的可能。
 *
 * 注意：用户手动切换浅色或自定义背景时，标题栏由 themeStore 通过
 * IPC 覆盖；本常量只决定**首帧兜底**。
 */

/** 深色基线：应用背景（等价于 token surface.app 的深色取值） */
export const FIRST_PAINT_BACKGROUND = '#111315'

/**
 * 默认强调色。
 *
 * 取值依据：白字在其上达到 5.67:1（AA 要求 4.5），
 * hover/active 向黑派生后进一步提升到 7.10 / 8.36。
 * 早先的 #4d6bfe 白字仅 4.33:1，会导致按钮只能用黑字，观感与可读性都差。
 */
export const DEFAULT_ACCENT = '#3b5bdb'

/** 深色基线：主文字色（等价于 token text.primary 的深色取值） */
export const FIRST_PAINT_SYMBOL = '#e6e8ea'
