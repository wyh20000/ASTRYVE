/**
 * 操作系统深浅色偏好的读取与订阅。
 *
 * 单独成文件的原因：
 * - `tokens.ts`（纯令牌解析）与 `applyTheme.ts`（DOM 应用层）都需要它，
 *   放在任一侧都会造成循环依赖；
 * - 这里的唯一职责是访问 `matchMedia`，且必须对缺失环境保持安全，
 *   使令牌解析可以在 node 环境的单测中直接运行。
 */

/** 读取系统深浅色偏好；无 matchMedia（例如 node 单测）时回退深色 */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

/**
 * 订阅系统深浅色变化。
 * 返回取消订阅函数；环境不支持时返回空操作，调用方无需判空。
 */
export function subscribeSystemTheme(onChange: (isDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (event: MediaQueryListEvent): void => onChange(event.matches)

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }

  // Safari / 旧版 Chromium 只支持 addListener
  const legacy = query as MediaQueryList & {
    addListener?: (listener: (event: MediaQueryListEvent) => void) => void
    removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
  }
  legacy.addListener?.(handler)
  return () => legacy.removeListener?.(handler)
}

/**
 * 系统主题是否可用。
 * 用于区分「跟随系统」与「系统信号缺失回退」，避免把回退值误当成用户选择。
 */
export function isSystemThemeSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}
