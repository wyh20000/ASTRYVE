import { useRef, useState, type KeyboardEvent } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useUiStore } from '../../stores/uiStore'
import type { ReasoningEffort } from '@shared/types'
import { Icon } from '../ui/icons'

const MAX_H = 200
const EFFORT_LABEL: Record<ReasoningEffort, string> = { low: '低', medium: '中', high: '高' }
const EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high']

export function ChatInput({ sessionId }: { sessionId: string }): JSX.Element {
  const [value, setValue] = useState('')
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

  const autosize = (): void => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`
  }

  return (
    <div className="shrink-0 px-4 pb-2 pt-3">
      <div className="mx-auto max-w-[820px]">
        <div className="rounded-xl border border-border bg-bg-panel focus-within:border-accent">
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              autosize()
            }}
            onKeyDown={onKeyDown}
            placeholder="向 AI Agent 发送消息..."
            className="block max-h-[200px] w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed text-txt-primary outline-none placeholder:text-txt-muted"
            style={{ height: 'auto' }}
          />
          <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1">
            <ModelSelector />
            <div className="ml-auto flex items-center gap-1">
              <button className="btn-icon" title="附件">
                <Icon.Paperclip size={16} />
              </button>
              <button className="btn-icon" title="图片">
                <Icon.Image size={16} />
              </button>
              <button
                disabled={!value.trim() || !sessionId || sending}
                onClick={doSend}
                className="btn h-8 w-8 shrink-0 rounded-full bg-accent text-white hover:bg-accent/80"
                title="发送"
              >
                <Icon.SendRound size={15} />
              </button>
            </div>
          </div>
        </div>
        <div className="mt-2 text-center text-[11px] text-txt-muted">
          AI 生成的内容可能不准确，请注意甄别
        </div>
      </div>
    </div>
  )
}

function ModelSelector(): JSX.Element {
  const config = useModelStore((s) => s.config)
  const activate = useModelStore((s) => s.activate)
  const setReasoning = useModelStore((s) => s.setReasoning)
  const openSettings = useUiStore((s) => s.openSettings)
  const [open, setOpen] = useState(false)

  const active = config?.presets.find((p) => p.id === config.activePresetId)
  const effort = config?.reasoningEffort ?? 'medium'

  if (!config || !active) {
    return (
      <button onClick={() => openSettings()} className="text-[12px] text-txt-muted hover:text-txt-secondary">
        配置模型
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-txt-secondary hover:bg-bg-raised"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-white">
          {active.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="max-w-[150px] truncate">{active.name}</span>
        <span className="rounded bg-bg-active px-1 text-[10px] text-txt-muted">{EFFORT_LABEL[effort]}</span>
        <Icon.ChevronDown size={13} className={open ? 'rotate-180' : ''} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-[250px] overflow-hidden rounded-md border border-border bg-bg-raised shadow-xl">
          <div className="border-b border-border px-3 py-1.5 text-[11px] text-txt-muted">模型</div>
          {config.presets.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                void activate(p.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-bg-active ${
                p.id === config.activePresetId ? 'text-txt-primary' : 'text-txt-secondary'
              }`}
            >
              <span className="flex-1 truncate">{p.name}</span>
              <span className="max-w-[90px] truncate text-[11px] text-txt-muted">{p.model}</span>
              {p.id === config.activePresetId && <Icon.Check size={13} className="text-accent" />}
            </button>
          ))}
          <button
            onClick={() => {
              setOpen(false)
              openSettings()
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-accent hover:bg-bg-active"
          >
            <Icon.Settings size={14} />
            配置 / 管理模型
          </button>
          <div className="border-b border-border px-3 py-1.5 text-[11px] text-txt-muted">推理等级</div>
          <div className="flex gap-1 px-2 py-1.5">
            {EFFORTS.map((r) => (
              <button
                key={r}
                onClick={() => {
                  void setReasoning(r)
                  setOpen(false)
                }}
                className={`flex-1 rounded-md px-2 py-1 text-[12px] ${
                  effort === r ? 'bg-accent text-white' : 'bg-bg-panel text-txt-secondary hover:bg-bg-active'
                }`}
              >
                {EFFORT_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
