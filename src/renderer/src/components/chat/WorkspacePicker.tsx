import { useEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { Icon } from '../ui/icons'

interface WorkspacePickerProps {
  sessionId: string
  projectPath?: string | null
}

export function WorkspacePicker({ sessionId, projectPath }: WorkspacePickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const recent = useWorkspaceStore((state) => state.recent)
  const loading = useWorkspaceStore((state) => state.loading)
  const error = useWorkspaceStore((state) => state.error)
  const activate = useWorkspaceStore((state) => state.activate)
  const selectAndActivate = useWorkspaceStore((state) => state.selectAndActivate)
  const active = recent.find((workspace) => workspace.displayPath === projectPath)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        className="chip flex max-w-[240px] items-center gap-1.5 border border-border bg-bg-panel text-txt-secondary hover:border-accent hover:text-txt-primary"
        onClick={() => setOpen((value) => !value)}
        title={active?.displayPath ?? '选择项目工作区'}
      >
        <Icon.Folder size={13} />
        <span className="truncate">{active?.name ?? '选择项目'}</span>
        <Icon.ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-bg-raised shadow-2xl">
          <div className="border-b border-border px-3 py-2 text-[11px] text-txt-muted">
            项目授权仅允许读取所选目录；写入和命令尚未开放。
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {recent.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-active"
                onClick={() => {
                  setOpen(false)
                  void activate(sessionId, workspace.id)
                }}
              >
                <Icon.Folder size={14} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-txt-primary">{workspace.name}</span>
                  <span className="block truncate text-[10px] text-txt-muted">{workspace.displayPath}</span>
                </span>
                {workspace.id === active?.id && <Icon.Check size={13} className="text-accent" />}
              </button>
            ))}
            {!recent.length && (
              <div className="px-3 py-3 text-[11px] text-txt-muted">还没有授权过的项目</div>
            )}
          </div>
          {error && <div className="border-t border-border px-3 py-2 text-[11px] text-red-400">{error}</div>}
          <button
            type="button"
            disabled={loading || !sessionId}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-[12px] text-txt-primary hover:bg-bg-active disabled:opacity-50"
            onClick={() => {
              setOpen(false)
              void selectAndActivate(sessionId)
            }}
          >
            <Icon.Plus size={14} />
            {loading ? '正在处理…' : '选择其他文件夹…'}
          </button>
        </div>
      )}
    </div>
  )
}
