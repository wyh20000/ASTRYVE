import type { Message } from '@shared/types'
import { Blocks, RichText } from './Blocks'
import { Icon } from '../ui/icons'
import { fullTime } from '../../lib/time'

export function MessageItem({ message }: { message: Message }): JSX.Element {
  if (message.role === 'user') return <UserMessage message={message} />
  return <AssistantMessage message={message} />
}

function UserMessage({ message }: { message: Message }): JSX.Element {
  const images = (message.attachments ?? []).filter((a) => a.kind === 'image')
  const files = (message.attachments ?? []).filter((a) => a.kind === 'file')
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%]">
        <div className="mb-1 flex items-center justify-end gap-2">
          <span className="text-[11px] text-txt-muted">{fullTime(message.timestamp)}</span>
          <span className="text-[11px] text-txt-secondary">我</span>
        </div>
        <div className="rounded-xl rounded-br-sm bg-bg-active px-4 py-2.5">
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {images.map((a) => (
                <img
                  key={a.id}
                  src={a.dataRef}
                  alt={a.name}
                  className="max-h-48 max-w-[240px] rounded-md border border-border object-contain"
                />
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className={`${images.length > 0 ? 'mb-2' : ''} flex flex-wrap gap-2`}>
              {files.map((a) => {
                const parsed = a.meta?.parsed as boolean | undefined
                const charCount = a.meta?.charCount as number | undefined
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-bg-raised px-2 py-1.5"
                  >
                    <Icon.File size={14} className="shrink-0 text-accent" />
                    <span className="truncate text-[12px] text-txt-secondary" title={a.name}>
                      {a.name}
                    </span>
                    {parsed === true && charCount != null && (
                      <span className="shrink-0 text-[10px] text-ok">已解析 {charCount} 字</span>
                    )}
                    {parsed === false && (
                      <span className="shrink-0 text-[10px] text-warn">解析失败</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {message.content.trim() ? <RichText text={message.content} /> : null}
        </div>
      </div>
    </div>
  )
}

function AssistantMessage({ message }: { message: Message }): JSX.Element {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent">
        <Icon.Brain size={15} className="text-white" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2 text-[12px] font-medium text-txt-secondary">
          AI Agent
        </div>
        {message.blocks && message.blocks.length > 0 ? (
          <Blocks blocks={message.blocks} status={message.status} />
        ) : (
          <RichText text={message.content} />
        )}
        {message.status === 'streaming' && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-txt-muted">
            正在生成
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-txt-muted [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-txt-muted [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-txt-muted [animation-delay:300ms]" />
            </span>
          </span>
        )}
      </div>
    </div>
  )
}