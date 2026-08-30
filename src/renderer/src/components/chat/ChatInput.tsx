import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ClipboardEvent,
  type DragEvent,
  type ChangeEvent
} from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useUiStore } from '../../stores/uiStore'
import type { ReasoningEffort, Attachment } from '@shared/types'
import { supportsBuiltInSearch, supportsImageInput } from '@shared/modelCapabilities'
import { Icon } from '../ui/icons'
import { fileToImageAttachment, fileToDocumentAttachment, isImageFile, isDocumentFile } from '../../lib/image'

const MAX_H = 200
const EFFORT_LABEL: Record<ReasoningEffort, string> = { low: '低', medium: '中', high: '高' }
const EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high']
interface ProcessingFile {
  id: string
  name: string
  kind: 'image' | 'file'
}

function formatBytes(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

export function ChatInput({ sessionId }: { sessionId: string }): JSX.Element {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([])
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState(false)
  const send = useChatStore((s) => s.send)
  const sending = useChatStore((s) => s.sending[sessionId] ?? false)
  const streamNotice = useChatStore((s) => s.notices[sessionId])
  const clearStreamNotice = useChatStore((s) => s.clearNotice)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const config = useModelStore((s) => s.config)
  const activePreset = config?.presets.find((p) => p.id === config.activePresetId)

  const images = attachments.filter((a) => a.kind === 'image')
  const files = attachments.filter((a) => a.kind === 'file')
  const visionBlocked = images.length > 0 && !supportsImageInput(activePreset?.model ?? '')
  const canSend =
    (value.trim().length > 0 || attachments.length > 0) &&
    !!sessionId &&
    !sending &&
    processingFiles.length === 0

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!streamNotice) return
    const timer = setTimeout(() => clearStreamNotice(sessionId, streamNotice.id), 5000)
    return () => clearTimeout(timer)
  }, [clearStreamNotice, sessionId, streamNotice])

  const showNotice = (message: string): void => {
    setNotice(message)
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = message ? setTimeout(() => setNotice(''), 3200) : null
  }

  const addFiles = async (incoming: File[]): Promise<void> => {
    const jobs = incoming.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      kind: isImageFile(file) ? ('image' as const) : ('file' as const)
    }))
    setProcessingFiles((prev) => [...prev, ...jobs.map(({ id, name, kind }) => ({ id, name, kind }))])
    const errors: string[] = []
    await Promise.all(
      jobs.map(async ({ id, file }) => {
        try {
          let attachment: Attachment
          if (isImageFile(file)) attachment = await fileToImageAttachment(file)
          else if (isDocumentFile(file)) attachment = await fileToDocumentAttachment(file)
          else throw new Error(`不支持的文件：${file.name}`)
          setAttachments((prev) => [...prev, attachment])
        } catch (e) {
          errors.push((e as Error)?.message ?? '读取失败')
        } finally {
          setProcessingFiles((prev) => prev.filter((item) => item.id !== id))
        }
      })
    )
    showNotice(errors[0] ?? '')
  }

  const removeAttachment = (id: string): void => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const doSend = async (): Promise<void> => {
    const v = value.trim()
    if ((!v && attachments.length === 0) || !sessionId) return
    if (visionBlocked) {
      showNotice('信息不能发送，此模型无法进行图片处理')
      return
    }
    const result = await send(sessionId, v, attachments, search)
    if (!result.ok) {
      showNotice(result.error.message)
      return
    }
    setValue('')
    setAttachments([])
    showNotice('')
    clearStreamNotice(sessionId)
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void doSend()
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => isImageFile(f) || isDocumentFile(f))
    if (files.length) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => isImageFile(f) || isDocumentFile(f))
    void addFiles(files)
  }

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? [])
    void addFiles(files)
    e.target.value = ''
  }

  const autosize = (): void => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`
  }

  return (
    <div className="shrink-0 px-4 pb-2 pt-3" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="relative mx-auto max-w-[820px]">
        {(notice || streamNotice?.message) && (
          <div
            role="alert"
            className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 rounded-md border border-warn/40 bg-bg-raised px-3 py-2 text-[12px] text-warn shadow-xl"
          >
            {notice || streamNotice?.message}
          </div>
        )}
        <div className="rounded-xl border border-border bg-bg-panel focus-within:border-accent">
          {(images.length > 0 || files.length > 0 || processingFiles.length > 0) && (
            <div className="flex flex-wrap gap-2 px-3 pt-2.5">
              {processingFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex max-w-[220px] items-center gap-2 rounded-md border border-border bg-bg-raised px-2 py-1.5"
                  aria-live="polite"
                >
                  <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
                  <span className="min-w-0 truncate text-[12px] text-txt-secondary" title={file.name}>
                    {file.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-txt-muted">
                    {file.kind === 'image' ? '压缩中' : '读取中'}
                  </span>
                </div>
              ))}
              {images.map((a) => (
                <div
                  key={a.id}
                  className="relative h-16 w-16 overflow-hidden rounded-md border border-border bg-bg-raised"
                >
                  <img src={a.dataRef} alt={a.name} className="h-full w-full object-cover" />
                  <button
                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    title="移除"
                    onClick={() => removeAttachment(a.id)}
                  >
                    <Icon.X size={10} />
                  </button>
                </div>
              ))}
              {files.map((a) => (
                <div
                  key={a.id}
                  className="flex max-w-[220px] items-center gap-2 rounded-md border border-border bg-bg-raised px-2 py-1.5"
                >
                  <Icon.File size={14} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-txt-secondary" title={a.name}>
                    {a.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-txt-muted">{formatBytes(a.meta?.sizeBytes as number | undefined)}</span>
                  <button
                    className="shrink-0 text-txt-muted hover:text-txt-primary"
                    title="移除"
                    onClick={() => removeAttachment(a.id)}
                  >
                    <Icon.X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              autosize()
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="向 AI Agent 发送消息..."
            className="chat-input-textarea block max-h-[200px] w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed text-txt-primary outline-none placeholder:text-txt-muted"
            style={{ height: 'auto' }}
          />
          <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1">
            <ModelSelector />
            <div className="ml-auto flex items-center gap-1">
              {supportsBuiltInSearch(activePreset?.provider) && activePreset && (
                <button
                  onClick={() => setSearch((v) => !v)}
                  className={`chip border ${search ? 'border-accent bg-accent-dim/20 text-accent' : 'border-border text-txt-muted hover:text-txt-secondary'}`}
                  title={`联网搜索（${activePreset.provider === 'deepseek' ? 'DeepSeek' : 'Kimi'}）`}
                >
                  <Icon.Search size={12} />
                  {search ? '联网已开' : '联网'}
                </button>
              )}
              <button className="btn-icon" title="附件（PDF/Word/Excel/CSV）" onClick={() => docRef.current?.click()}>
                <Icon.Paperclip size={16} />
              </button>
              <button className="btn-icon" title="图片（粘贴 / 拖拽 / 选择）" onClick={() => imgRef.current?.click()}>
                <Icon.Image size={16} />
              </button>
              <button
                disabled={!canSend}
                onClick={() => void doSend()}
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
      <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={onPick} />
      <input
        ref={docRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.markdown,.json,.log"
        multiple
        className="hidden"
        onChange={onPick}
      />
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
