import { useState } from 'react'
import { Bubble } from '@ant-design/x'
import type { ReactNode } from 'react'
import type { Message } from '@shared/types'
import { Blocks, RichText } from './Blocks'
import { IconButton } from '../ui'
import { Icon } from '../ui/icons'
import { fullTime } from '../../lib/time'
import { ImageAttachments } from './ImageAttachments'

/**
 * 单条消息。
 *
 * 阶段 C（设计文档 7.2）：
 * - 用户消息使用 Ant Design X 的 `Bubble`，placement="end" + shape="corner"
 *   （气泡形，右侧尾巴），保留附件预览、复制与时间；
 * - Agent 消息 placement="start" 且 variant="borderless"，
 *   内容继续由现有 Blocks / RichText 渲染 —— 消息模型与流式状态完全不变；
 * - 这里只用 `Bubble` 负责「布局与气泡外观」，不引入 X 的请求层或
 *   `useXChat`（文档 2.3 / 7.2 的非目标）。
 *
 * 结构说明：`Bubble` 的 content 传空字符串，实际内容走 `contentRender`，
 * 这样附件与富文本仍由既有组件渲染，不改变任何数据流。
 */

export function MessageItem({ message }: { message: Message }): JSX.Element {
  if (message.role === 'user') return <UserMessage message={message} />
  return <AssistantMessage message={message} />
}

/** 用户消息气泡的正文：图片、文件与富文本，顺序与迁移前一致 */
function UserBubbleBody({ message }: { message: Message }): JSX.Element {
  const images = (message.attachments ?? []).filter((a) => a.kind === 'image')
  const files = (message.attachments ?? []).filter((a) => a.kind === 'file')

  return (
    <>
      {images.length > 0 && (
        <ImageAttachments images={images} className="mb-2" />
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
                <span className="truncate text-[14px] text-txt-secondary" title={a.name}>
                  {a.name}
                </span>
                {parsed === true && charCount != null && (
                  <span className="shrink-0 text-[14px] text-ok">已解析 {charCount} 字</span>
                )}
                {parsed === false && (
                  <span className="shrink-0 text-[14px] text-warn">解析失败</span>
                )}
              </div>
            )
          })}
        </div>
      )}
      {message.content.trim() ? <RichText text={message.content} /> : null}
    </>
  )
}

function UserMessage({ message }: { message: Message }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const hasText = message.content.trim().length > 0

  const copy = (): void => {
    void navigator.clipboard
      .writeText(message.content)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => undefined)
  }

  return (
    <div className="group flex justify-end">
      <div className="max-w-[78%]">
        {/* 头部信息不在气泡内：复制按钮与时间保持原有位置与样式 */}
        <div className="mb-1 flex items-center justify-end gap-2">
          {hasText && (
            <IconButton
              size="sm"
              icon={copied ? <Icon.Check size={14} /> : <Icon.Copy size={14} />}
              label={copied ? '已复制' : '复制消息'}
              onClick={copy}
            />
          )}
          <span className="text-[14px] text-txt-muted">{fullTime(message.timestamp)}</span>
          <span className="text-[14px] text-txt-secondary">我</span>
        </div>

        <Bubble
          placement="end"
          shape="corner"
          variant="filled"
          content=""
          contentRender={() => <UserBubbleBody message={message} />}
        />
      </div>
    </div>
  )
}

/**
 * Agent 消息。
 *
 * 只有「真的有内容」时才套气泡：否则空内容会渲染出一个空气泡壳。
 * 无内容时的失败态与流式指示器沿用迁移前的分支。
 */
function AssistantMessage({ message }: { message: Message }): JSX.Element {
  const hasThinking = message.blocks?.some((block) => block.kind === 'thinking') ?? false
  const hasText = message.content.trim().length > 0
  const hasBlocks = (message.blocks?.length ?? 0) > 0
  const images = (message.attachments ?? []).filter((attachment) => attachment.kind === 'image')
  /*
   * 思考面板的展开状态由这一层持有。
   *
   * 块列表在流式期间会被主进程整段重拼（重试、联网回退前还会清空），
   * 期间 `Blocks` 子树可能被卸载重建；状态放在更上层，
   * 用户手动点开的面板就不会因为这些重建而莫名其妙地收起来。
   */
  const [thinkingOpen, setThinkingOpen] = useState<Record<string, boolean>>({})

  let body: ReactNode
  if (hasBlocks) {
    body = (
      <Blocks
        blocks={message.blocks ?? []}
        status={message.status}
        attachments={message.attachments ?? []}
        thinkingOpen={thinkingOpen}
        onToggleThinking={(key, next) => setThinkingOpen((s) => ({ ...s, [key]: next }))}
      />
    )
  } else if (message.status === 'error' && !hasText) {
    body = (
      <div className="max-w-[520px] rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[14px] text-err">
        本次执行未完成，请重试。已完成的内容不会受影响。
      </div>
    )
  } else if (hasText) {
    body = <RichText text={message.content} />
  } else {
    body = null
  }

  const hasOrderedImages = message.blocks?.some((block) => block.kind === 'image') ?? false
  if (images.length > 0 && !hasOrderedImages) {
    body = <div className="space-y-3">{body}<ImageAttachments images={images} /></div>
  }

  const showDots = message.status === 'streaming' && (hasText || !hasThinking)

  return (
    <div className="min-w-0 space-y-2">
      {body ? (
        <Bubble
          placement="start"
          variant="borderless"
          content=""
          contentRender={() => body}
        />
      ) : null}
      {showDots && (
        <span
          className="reply-dots"
          role="status"
          aria-label={hasText ? '正在生成' : '正在生成回答'}
        >
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  )
}
