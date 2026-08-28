import type { Message } from '@shared/types'
import { Blocks, RichText } from './Blocks'
import MarkdownRenderer from './MarkdownRenderer'
import { Icon } from '../ui/icons'
import { fullTime } from '../../lib/time'

export function MessageItem({ message }: { message: Message }): JSX.Element {
  if (message.role === 'user') return <UserMessage message={message} />
  return <AssistantMessage message={message} />
}

function UserMessage({ message }: { message: Message }): JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%]">
        <div className="mb-1 flex items-center justify-end gap-2">
          <span className="text-[11px] text-txt-muted">{fullTime(message.timestamp)}</span>
          <span className="text-[11px] text-txt-secondary">我</span>
        </div>
        <div className="rounded-xl rounded-br-sm bg-bg-active px-4 py-2.5">
          <MarkdownRenderer>{message.content}</MarkdownRenderer>
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
          <span className="animate-pulse text-[12px] text-txt-muted">生成中...</span>
        )}
      </div>
    </div>
  )
}
