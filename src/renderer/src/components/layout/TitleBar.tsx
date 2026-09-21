import type { CSSProperties } from 'react'

const drag: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties

/** 顶部自定义拖拽条（仅 Windows，配合 titleBarOverlay 让标题栏随主题变色） */
export default function TitleBar(): JSX.Element {
  const isWin = typeof window !== 'undefined' && window.agent?.platform === 'win32'
  if (!isWin) return <></>

  return (
    <div className="h-8 shrink-0 select-none bg-bg-app" style={drag}>
      <div className="flex h-full items-center gap-2 px-3 text-[14px] text-txt-secondary">
        <span className="font-medium tracking-[0.08em] text-txt-primary">ASTRYVE</span>
        <span className="text-txt-muted">桌面智能体</span>
      </div>
    </div>
  )
}
