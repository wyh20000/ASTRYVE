import { useEffect, useRef, type RefObject } from 'react'

/**
 * 统一管理非模态浮层的关闭行为。
 *
 * - 点击浮层与触发器之外的区域时关闭；
 * - 按 Escape 时关闭，并把焦点还给浮层内的触发器；
 * - 使用 pointerdown capture，确保外部控件自己的 click 行为不受影响。
 */
export function useDismissibleLayer<T extends HTMLElement>(
  root: RefObject<T>,
  open: boolean,
  onDismiss: () => void
): void {
  const dismissRef = useRef(onDismiss)

  useEffect(() => {
    dismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (!open) return

    const dismissOutside = (event: PointerEvent): void => {
      const element = root.current
      if (!element || event.composedPath().includes(element)) return
      dismissRef.current()
    }

    const dismissWithKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      const trigger = root.current?.querySelector<HTMLElement>(
        '[aria-expanded="true"], summary, button'
      )
      dismissRef.current()
      trigger?.focus()
    }

    document.addEventListener('pointerdown', dismissOutside, true)
    document.addEventListener('keydown', dismissWithKeyboard)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      document.removeEventListener('keydown', dismissWithKeyboard)
    }
  }, [open, root])
}
