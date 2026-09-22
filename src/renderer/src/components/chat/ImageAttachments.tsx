import { useState } from 'react'
import type { Attachment } from '@shared/types'
import { Button } from '../ui'
import { Icon } from '../ui/icons'

export function ImageAttachments({
  images,
  className = '',
  collapsible = false,
  title = '图片'
}: {
  images: Attachment[]
  className?: string
  collapsible?: boolean
  title?: string
}): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [selected, setSelected] = useState<Attachment>()
  const [scale, setScale] = useState(1)
  const open = (image: Attachment): void => {
    setSelected(image)
    setScale(1)
  }
  const close = (): void => {
    setSelected(undefined)
    setScale(1)
  }
  return <div className={className}>
    {collapsible && <button
      type="button"
      className="mb-2 flex items-center gap-2 text-[14px] text-txt-secondary hover:text-txt-primary"
      aria-expanded={expanded}
      aria-label={`${expanded ? '收起' : '展开'}${title}`}
      onClick={() => setExpanded((value) => !value)}
    >
      <Icon.ChevronRight size={13} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
      <span>{title}</span>
    </button>}
    {expanded && <div className="flex flex-wrap gap-2">
      {images.map((image) => <button
        key={image.id}
        type="button"
        className="overflow-hidden rounded-md border border-border bg-bg-panel hover:border-accent"
        aria-label={`预览图片 ${image.name}`}
        onClick={() => open(image)}
      >
        <img
          src={image.dataRef}
          alt={image.name}
          className="max-h-56 max-w-[360px] object-contain"
        />
      </button>)}
    </div>}
    {selected && <div
      role="dialog"
      aria-modal="true"
      aria-label={`图片预览 ${selected.name}`}
      className="fixed inset-0 z-[1000] flex flex-col bg-black/85 p-4"
      onClick={close}
    >
      <div className="mb-3 flex items-center justify-center gap-2" onClick={(event) => event.stopPropagation()}>
        <Button size="sm" onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}>缩小</Button>
        <Button size="sm" onClick={() => setScale(1)}>{Math.round(scale * 100)}%</Button>
        <Button size="sm" onClick={() => setScale((value) => Math.min(3, value + 0.25))}>放大</Button>
        <Button size="sm" onClick={close}>关闭预览</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" onClick={(event) => event.stopPropagation()}>
        <div className="flex min-h-full min-w-full items-center justify-center">
          <img
            src={selected.dataRef}
            alt={selected.name}
            className="max-h-[calc(100vh-7rem)] max-w-[calc(100vw-2rem)] object-contain transition-transform"
            style={{ transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </div>}
  </div>
}
