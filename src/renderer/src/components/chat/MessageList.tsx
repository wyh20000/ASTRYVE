import { useEffect, useRef, useState } from 'react'
import type { Message } from '@shared/types'
import { MessageItem } from './MessageItem'

export function MessageList({ messages }: { messages: Message[] }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)

  useEffect(() => {
    if (stick) {
      const el = ref.current
      if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
    }
  }, [messages, stick])

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const content = el.firstElementChild
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (stick) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [stick])

  return (
    <div
      ref={ref}
      className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4"
      onScroll={(e) => {
        const el = e.currentTarget
        setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
      }}
    >
      <div
        className="mx-auto max-w-[820px] space-y-6"
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((m) => <MessageItem key={m.id} message={m} />)
        )}
      </div>

      {!stick && messages.length > 0 && (
        <button
          onClick={() => {
            setStick(true)
            const el = ref.current
            if (el) el.scrollTop = el.scrollHeight
          }}
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-bg-raised px-3 py-1 text-[11px] text-txt-secondary shadow-lg hover:text-txt-primary"
        >
          回到底部
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
      <div className="max-w-[360px] text-[12px] text-txt-muted">
        发送消息即可与 AI 流式对话；在「设置 → 模型设置」中配置模型后生效，未配置时使用本地演示。
      </div>
    </div>
  )
}
