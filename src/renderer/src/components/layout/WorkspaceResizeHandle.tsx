import { useUiStore } from '../../stores/uiStore'

export default function WorkspaceResizeHandle(): JSX.Element {
  const setWidth = useUiStore((state) => state.setWorkspaceWidth)
  const onMouseDown = (event: React.MouseEvent): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = useUiStore.getState().workspaceWidth
    const move = (next: MouseEvent): void => setWidth(Math.max(420, Math.min(1100, startWidth - (next.clientX - startX))))
    const up = (): void => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''; document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
  }
  return <div onMouseDown={onMouseDown} className="relative z-10 w-[6px] shrink-0 cursor-col-resize bg-bg-panel hover:bg-accent" title="拖拽调整任务工作区宽度">
    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
  </div>
}
