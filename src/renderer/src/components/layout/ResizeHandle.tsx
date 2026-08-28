import { useUiStore } from '../../stores/uiStore'

/** 侧栏与内容区之间的拖拽分隔条，用于加宽/变窄侧栏 */
export default function ResizeHandle(): JSX.Element {
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)

  const onMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = useUiStore.getState().sidebarWidth
    const move = (ev: MouseEvent): void => {
      const w = Math.min(400, Math.max(180, startW + (ev.clientX - startX)))
      setSidebarWidth(w)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div
      onMouseDown={onMouseDown}
      title="拖拽调整宽度"
      className="relative z-10 w-[6px] shrink-0 cursor-col-resize bg-bg-panel transition-colors hover:bg-accent"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
      <div className="absolute inset-y-0 -left-2 -right-2" />
    </div>
  )
}