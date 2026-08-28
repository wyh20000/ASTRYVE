import { useRef, useState, type KeyboardEvent } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { Icon } from '../ui/icons'

export function ChatInput({ sessionId }: { sessionId: string }): JSX.Element {
  const [value, setValue] = useState('')
  const modelName = useModelStore((s) => s.config?.model)
  const send = useChatStore((s) => s.send)
  const sending = useChatStore((s) => s.sending[sessionId] ?? false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const doSend = (): void => {
    const v = value.trim()
    if (!v || !sessionId) return
    void send(sessionId, v)
    setValue('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
    }
  }

  return (
    <div className="shrink-0 border-t border-border px-4 pb-2 pt-3">
      <div className="mx-auto max-w-[820px]">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          {modelName && (
            <span className="selectable text-txt-muted">
              当前模型：<span className="text-txt-secondary">{modelName}</span>
            </span>
          )}
          <span className="selectable text-txt-muted">⌘K 新建 · ⌘N 新会话</span>
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-border bg-bg-panel px-3 py-2 focus-within:border-accent">
          <button className="btn-icon" title="附件">
            <Icon.Paperclip size={16} />
          </button>
          <button className="btn-icon" title="图片">
            <Icon.Image size={16} />
          </button>
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="向 AI Agent 发送消息..."
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13px] text-txt-primary outline-none placeholder:text-txt-muted"
          />
          <button className="btn-icon" title="引用">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-bg-raised text-[11px] text-txt-secondary">
              1
            </span>
          </button>
          <button
            disabled={!value.trim() || !sessionId || sending}
            onClick={doSend}
            className="btn h-8 w-8 shrink-0 rounded-full bg-accent text-white hover:bg-accent/80"
            title="发送"
          >
            <Icon.Send size={16} />
          </button>
        </div>
        <div className="mt-2 text-center text-[11px] text-txt-muted">
          AI 生成的内容可能不准确，请注意甄别
        </div>
      </div>
    </div>
  )
}
