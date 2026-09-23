import { useEffect, useRef, useState } from 'react'
import type { Message } from '@shared/types'
import { MessageItem } from './MessageItem'
import { Icon } from '../ui/icons'

export function MessageList({ messages, hasOlder = false, loadingOlder = false, loadError = false, onLoadOlder }:
  { messages: Message[]; hasOlder?: boolean; loadingOlder?: boolean; loadError?: boolean;
    onLoadOlder?: () => Promise<void> }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  const [hasNewContent, setHasNewContent] = useState(false)
  const [olderLoadError, setOlderLoadError] = useState(false)
  const stickRef = useRef(true)
  const pendingScrollRef = useRef<number | null>(null)

  const cancelPendingScroll = (): void => {
    if (pendingScrollRef.current == null) return
    cancelAnimationFrame(pendingScrollRef.current)
    pendingScrollRef.current = null
  }

  const setFollowing = (next: boolean): void => {
    stickRef.current = next
    setStick((current) => current === next ? current : next)
    if (!next) cancelPendingScroll()
  }

  const scheduleScrollToBottom = (): void => {
    cancelPendingScroll()
    const element = ref.current
    if (!element || !stickRef.current) return
    pendingScrollRef.current = requestAnimationFrame(() => {
      pendingScrollRef.current = null
      if (stickRef.current) element.scrollTop = element.scrollHeight
    })
  }

  useEffect(() => {
    setHasNewContent(!stickRef.current)
    scheduleScrollToBottom()
    return cancelPendingScroll
  }, [messages])

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const content = el.firstElementChild
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        className="h-full overflow-y-auto px-4 py-4"
        onPointerDown={() => setFollowing(false)}
        onWheel={(event) => {
          const el = event.currentTarget
          // 向下滚轮已经到达底部时不会改变阅读位置，不应显示“回到底部”。
          if (el.scrollHeight <= el.clientHeight + 1) return
          const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          if (event.deltaY < 0 || distanceToBottom > 1) setFollowing(false)
        }}
        onScroll={(e) => {
          const el = e.currentTarget
          const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          if (distanceToBottom <= 2) {
            if (!stickRef.current) {
              setFollowing(true)
              setHasNewContent(false)
            }
            return
          }
          if (stickRef.current && distanceToBottom >= 80) {
            setFollowing(false)
          }
        }}
      >
        <div className="mx-auto max-w-[820px] space-y-6">
          {hasOlder && onLoadOlder && (
            <button type="button" disabled={loadingOlder} className="mx-auto block rounded-md px-3 py-1 text-[13px] text-txt-secondary hover:bg-bg-panel disabled:opacity-50"
              onClick={() => {
                const element = ref.current
                const previousHeight = element?.scrollHeight ?? 0
                setOlderLoadError(false)
                void onLoadOlder().then(() => requestAnimationFrame(() => {
                  if (element) element.scrollTop += element.scrollHeight - previousHeight
                })).catch(() => setOlderLoadError(true))
              }}>
              {loadingOlder ? '加载中…' : olderLoadError ? '加载失败，点击重试' : '加载更早消息'}
            </button>
          )}
          {messages.length === 0 && !loadError ? (
            <EmptyState />
          ) : (
            messages.map((m) => <MessageItem key={m.id} message={m} />)
          )}
        </div>
      </div>

      {!stick && messages.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setFollowing(true)
            setHasNewContent(false)
            const el = ref.current
            if (el) el.scrollTop = el.scrollHeight
          }}
          aria-label={hasNewContent ? '查看新内容并回到底部' : '回到底部'}
          className="absolute bottom-3 left-1/2 z-10 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border-strong bg-surface-overlay px-3 text-[14px] font-medium text-txt-secondary shadow-overlay transition-colors hover:border-accent hover:text-txt-primary"
        >
          <Icon.ChevronDown size={14} />
          <span>{hasNewContent ? '新内容' : '回到底部'}</span>
        </button>
      )}
    </div>
  )
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-raised">
        <span className="text-[20px]">💬</span>
      </div>
      <div className="text-[14px] text-txt-secondary">开始一段新的对话</div>
      <div className="max-w-[360px] text-[14px] text-txt-muted">
        发送消息即可与 AI 流式对话；在「设置 → 模型设置」中配置模型后生效，未配置时使用本地演示。
      </div>
    </div>
  )
}
