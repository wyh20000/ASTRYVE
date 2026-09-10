import {
  useRef,
  useEffect,
  useState,
  type KeyboardEvent,
  type ClipboardEvent,
  type DragEvent,
  type ChangeEvent
} from 'react'
import { App as AntdApp } from 'antd'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useUiStore } from '../../stores/uiStore'
import type { ReasoningEffort, Attachment, UserInputRequest } from '@shared/types'
import { supportsImageInput } from '@shared/modelCapabilities'
import { Icon } from '../ui/icons'
import { fileToImageAttachment, fileToDocumentAttachment, isImageFile, isDocumentFile } from '../../lib/image'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { stepInputHistory, type InputHistoryState } from './inputHistory'
import { useSkillStore } from '../../stores/skillStore'
import { usePluginStore } from '../../stores/pluginStore'

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
  const { message: messageApi } = AntdApp.useApp()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([])
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [pluginDismissed, setPluginDismissed] = useState(false)
  const [pluginIndex, setPluginIndex] = useState(0)
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const sending = useChatStore((s) => s.sending[sessionId] ?? false)
  const inputRequest = useChatStore((s) => s.inputRequests[sessionId])
  const clearInputRequest = useChatStore((s) => s.clearInputRequest)
  const inputHistory = useChatStore((state) => (state.messages[sessionId] ?? [])
    .filter((message) => message.role === 'user' && message.content.trim())
    .map((message) => message.content))
  const taRef = useRef<HTMLTextAreaElement>(null)
  const historyState = useRef<InputHistoryState>({ index: null, draft: '' })
  const imgRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const pluginMenuRef = useRef<HTMLDivElement>(null)

  const config = useModelStore((s) => s.config)
  const activePreset = config?.presets.find((p) => p.id === config.activePresetId)
  const projectPath = useSessionStore((state) =>
    state.sessions.find((session) => session.id === sessionId)?.projectPath
  )
  const workspaceId = useWorkspaceStore((state) =>
    state.recent.find((workspace) => workspace.displayPath === projectPath)?.id
  )
  const skills = useSkillStore((state) => state.items)
  const loadSkills = useSkillStore((state) => state.load)
  const plugins = usePluginStore((state) => state.items)
  const loadPlugins = usePluginStore((state) => state.load)

  useEffect(() => {
    void loadSkills(workspaceId)
    void loadPlugins()
  }, [workspaceId, loadSkills, loadPlugins])

  useEffect(() => {
    historyState.current = { index: null, draft: '' }
    setValue('')
    setSlashDismissed(false)
    setSlashIndex(0)
    setPluginDismissed(false)
    setPluginIndex(0)
  }, [sessionId])

  const images = attachments.filter((a) => a.kind === 'image')
  const files = attachments.filter((a) => a.kind === 'file')
  const visionBlocked = images.length > 0 && (!activePreset || !supportsImageInput(activePreset))
  const canSend =
    (value.trim().length > 0 || attachments.length > 0) &&
    !!sessionId &&
    !sending &&
    !inputRequest &&
    processingFiles.length === 0
  const slashQuery = /^\/([a-z0-9_-]*)$/i.exec(value.trim())?.[1]?.toLowerCase()
  const slashSkills = slashQuery === undefined ? [] : skills
    .filter((skill) => skill.active && skill.enabled && !skill.errors.length && skill.name.includes(slashQuery))
    .slice(0, 8)
  const slashMenuOpen = slashQuery !== undefined && slashSkills.length > 0 && !slashDismissed
  const pluginMatch = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(value)
  const pluginQuery = pluginMatch?.[1]?.toLowerCase()
  const mentionPlugins = pluginQuery === undefined ? [] : plugins
    .filter((plugin) => plugin.enabled && plugin.status === 'ready' && plugin.components.includes('tools') &&
      (plugin.id.includes(pluginQuery) || plugin.name.toLowerCase().includes(pluginQuery)))
    .slice(0, 8)
  const pluginMenuOpen = !slashMenuOpen && pluginQuery !== undefined && mentionPlugins.length > 0 && !pluginDismissed
  const selectedPlugins = selectedPluginMentions(value, plugins)

  useEffect(() => {
    setSlashIndex((current) => Math.min(current, Math.max(0, slashSkills.length - 1)))
  }, [slashQuery, slashSkills.length])

  useEffect(() => {
    setPluginIndex((current) => Math.min(current, Math.max(0, mentionPlugins.length - 1)))
  }, [pluginQuery, mentionPlugins.length])

  useEffect(() => {
    if (!slashMenuOpen) return
    const dismissOutside = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target && target !== taRef.current && !slashMenuRef.current?.contains(target)) setSlashDismissed(true)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [slashMenuOpen])

  useEffect(() => {
    if (!pluginMenuOpen) return
    const dismissOutside = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target && target !== taRef.current && !pluginMenuRef.current?.contains(target)) setPluginDismissed(true)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [pluginMenuOpen])

  const showNotice = (content: string, level: 'warning' | 'error' = 'warning'): void => {
    if (!content) return
    void messageApi.open({ type: level, content, duration: 4 })
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
    showNotice(errors[0] ?? '', 'error')
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
    const result = await send(sessionId, v, attachments)
    if (!result.ok) {
      showNotice(result.error.message, 'error')
      return
    }
    setValue('')
    historyState.current = { index: null, draft: '' }
    setAttachments([])
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const chooseSlashSkill = (index: number): void => {
    const skill = slashSkills[index]
    if (!skill) return
    setValue(`/${skill.name} `)
    setSlashDismissed(true)
    historyState.current = { index: null, draft: `/${skill.name} ` }
    requestAnimationFrame(() => {
      autosize()
      taRef.current?.focus()
    })
  }

  const choosePlugin = (index: number): void => {
    const plugin = mentionPlugins[index]
    if (!plugin || !pluginMatch) return
    const start = pluginMatch.index + pluginMatch[0].lastIndexOf('@')
    const next = `${value.slice(0, start)}@${plugin.id} `
    setValue(next)
    setPluginDismissed(true)
    historyState.current = { index: null, draft: next }
    requestAnimationFrame(() => { autosize(); taRef.current?.focus() })
  }

  const removePlugin = (id: string): void => {
    const next = removePluginMention(value, id)
    setValue(next)
    setPluginDismissed(true)
    historyState.current = { index: null, draft: next }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (slashMenuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((current) => moveSlashSelection(current, slashSkills.length, e.key === 'ArrowDown' ? 1 : -1))
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        chooseSlashSkill(slashIndex)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
    }
    if (pluginMenuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPluginIndex((current) => moveSlashSelection(current, mentionPlugins.length, e.key === 'ArrowDown' ? 1 : -1))
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault(); choosePlugin(pluginIndex); return
      }
      if (e.key === 'Escape') { e.preventDefault(); setPluginDismissed(true); return }
    }
    const atFirstLine = e.currentTarget.selectionStart <= value.indexOf('\n') || !value.includes('\n')
    const lastBreak = value.lastIndexOf('\n')
    const atLastLine = e.currentTarget.selectionEnd > lastBreak
    if (!e.altKey && !e.ctrlKey && !e.metaKey &&
        ((e.key === 'ArrowUp' && atFirstLine) || (e.key === 'ArrowDown' && atLastLine))) {
      const direction = e.key === 'ArrowUp' ? 'previous' : 'next'
      const next = stepInputHistory(inputHistory, value, historyState.current, direction)
      if (next.value !== value || next.state.index !== historyState.current.index) {
        e.preventDefault()
        historyState.current = next.state
        setValue(next.value)
        requestAnimationFrame(() => {
          autosize()
          const textarea = taRef.current
          if (textarea) textarea.setSelectionRange(textarea.value.length, textarea.value.length)
        })
      }
      return
    }
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
        {inputRequest && <UserInputCard request={inputRequest} onResolved={() => {
          clearInputRequest(sessionId, inputRequest.id)
        }} />}
        <div className="rounded-xl border border-border bg-bg-panel focus-within:border-accent">
          {selectedPlugins.length > 0 && <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {selectedPlugins.map((plugin) => <span key={plugin.id}
              className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-accent/30 bg-accent-dim/15 px-2 py-1 text-[10px] text-txt-secondary">
              <Icon.Brain size={11} className="shrink-0 text-accent" />
              <span className="truncate">{plugin.name}</span>
              <button type="button" aria-label={`移除插件 ${plugin.name}`} onClick={() => removePlugin(plugin.id)}
                className="ml-0.5 text-txt-muted hover:text-txt-primary"><Icon.X size={10} /></button>
            </span>)}
          </div>}
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
              setSlashDismissed(false)
              setSlashIndex(0)
              setPluginDismissed(false)
              setPluginIndex(0)
              historyState.current = { index: null, draft: e.target.value }
              autosize()
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={Boolean(inputRequest)}
            placeholder={inputRequest ? '请先回答上方问题…' : '向 AI Agent 发送消息...'}
            className="chat-input-textarea block max-h-[200px] w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed text-txt-primary outline-none placeholder:text-txt-muted"
            style={{ height: 'auto' }}
          />
          {slashMenuOpen && (
            <div ref={slashMenuRef} role="listbox" aria-label="Skill 快捷指令"
              className="absolute bottom-[48px] left-2 right-2 z-40 overflow-hidden rounded-lg border border-border bg-bg-raised shadow-2xl">
              <div className="border-b border-border px-3 py-2 text-[11px] text-txt-muted">快捷指令 · 选择 Skill</div>
              {slashSkills.map((skill, index) => (
                <button key={skill.id} type="button" role="option" aria-selected={index === slashIndex}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left ${index === slashIndex ? 'bg-bg-active' : 'hover:bg-bg-active'}`}
                  onMouseEnter={() => setSlashIndex(index)} onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSlashSkill(index)}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-dim/25 text-accent"><Icon.Brain size={13} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-txt-primary">/{skill.name}</span>
                    <span className="block truncate text-[10px] text-txt-muted">{skill.displayName} · {skill.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {pluginMenuOpen && (
            <div ref={pluginMenuRef} role="listbox" aria-label="插件快捷选择"
              className="absolute bottom-[48px] left-2 right-2 z-40 overflow-hidden rounded-lg border border-border bg-bg-raised shadow-2xl">
              <div className="border-b border-border px-3 py-2 text-[11px] text-txt-muted">@ 插件 · 仅本次任务使用</div>
              {mentionPlugins.map((plugin, index) => (
                <button key={plugin.id} type="button" role="option" aria-selected={index === pluginIndex}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left ${index === pluginIndex ? 'bg-bg-active' : 'hover:bg-bg-active'}`}
                  onMouseEnter={() => setPluginIndex(index)} onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choosePlugin(index)}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-dim/25 text-accent"><Icon.Brain size={13} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-txt-primary">@{plugin.id}</span>
                    <span className="block truncate text-[10px] text-txt-muted">{plugin.name}{plugin.version ? ` · ${plugin.version}` : ''} · {plugin.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="chat-input-toolbar flex min-w-0 items-center gap-1.5 px-2.5 pb-2 pt-1">
            <ModelSelector />
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button className="btn-icon" title="附件（PDF/Word/Excel/CSV）" onClick={() => docRef.current?.click()}>
                <Icon.Paperclip size={16} />
              </button>
              <button className="btn-icon" title="图片（粘贴 / 拖拽 / 选择）" onClick={() => imgRef.current?.click()}>
                <Icon.Image size={16} />
              </button>
              {sending ? (
                <button
                  onClick={() => void stop(sessionId)}
                  className="btn h-8 w-8 shrink-0 rounded-full bg-accent text-white hover:bg-accent/80"
                  title="停止生成"
                >
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-white" />
                </button>
              ) : (
                <button
                  disabled={!canSend}
                  onClick={() => void doSend()}
                  className="btn h-8 w-8 shrink-0 rounded-full bg-accent text-white hover:bg-accent/80"
                  title="发送"
                >
                  <Icon.SendRound size={15} />
                </button>
              )}
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
        accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.markdown,.json,.log"
        multiple
        className="hidden"
        onChange={onPick}
      />
    </div>
  )
}

export function UserInputCard({ request, onResolved }: { request: UserInputRequest; onResolved: () => void }): JSX.Element {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const question = request.questions[index]
  const answer = question ? answers[question.id] ?? '' : ''
  const isLast = index === request.questions.length - 1

  useEffect(() => {
    setIndex(0); setAnswers({}); setSubmitting(false); setError('')
  }, [request.id])

  if (!question) return <></>
  const setAnswer = (value: string): void => setAnswers((current) => ({ ...current, [question.id]: value }))
  const submit = async (): Promise<void> => {
    if (!answer.trim()) return
    if (!isLast) { setIndex((current) => current + 1); return }
    setSubmitting(true); setError('')
    const result = await window.agent.message.respondInput({
      requestId: request.id,
      sessionId: request.sessionId,
      answers: { ...answers, [question.id]: answer.trim() }
    })
    if (result.ok) onResolved()
    else { setError(result.error.message); setSubmitting(false) }
  }

  return <div className="mb-2 overflow-hidden rounded-xl border border-accent/45 bg-bg-raised shadow-xl">
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-dim/30 text-accent"><Icon.Brain size={12} /></span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-txt-primary">{question.header || 'AI 需要你的选择'}</span>
      <span className="text-[10px] text-txt-muted">{index + 1}/{request.questions.length}</span>
    </div>
    <div className="px-3 py-2.5">
      <p className="mb-2 text-[12px] leading-5 text-txt-primary">{question.question}</p>
      {question.options?.length ? <div className="mb-2 grid gap-1.5 sm:grid-cols-2">
        {question.options.map((option, optionIndex) => <button key={option.label} type="button" onClick={() => setAnswer(option.label)}
          className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${answer === option.label
            ? 'border-accent bg-accent-dim/20 text-txt-primary' : 'border-border bg-bg-panel text-txt-secondary hover:border-border-strong'}`}>
          <span className="flex items-center gap-1.5 text-[11px] font-medium">
            <span>{String.fromCharCode(65 + optionIndex)}. {option.label}</span>
            {option.recommended && <span className="rounded bg-accent-dim/30 px-1.5 py-0.5 text-[9px] font-medium text-accent">推荐</span>}
          </span>
          {option.description && <span className="mt-0.5 block text-[10px] leading-4 text-txt-muted">{option.description}</span>}
        </button>)}
      </div> : null}
      <textarea rows={2} value={answer} onChange={(event) => setAnswer(event.target.value)}
        placeholder={question.options?.length ? '也可以填写自定义回答…' : '填写回答…'}
        className="block max-h-24 w-full resize-none rounded-lg border border-border bg-bg-app px-2.5 py-2 text-[11px] leading-4 text-txt-primary outline-none placeholder:text-txt-muted focus:border-accent" />
      <div className="mt-2 flex items-center gap-2">
        {error && <span className="min-w-0 flex-1 truncate text-[10px] text-red-300">{error}</span>}
        {!error && <span className="flex-1 text-[10px] text-txt-muted">回答会传回当前任务，AI 将继续执行</span>}
        {index > 0 && <button type="button" disabled={submitting} onClick={() => setIndex((current) => current - 1)}
          className="rounded-md px-2.5 py-1.5 text-[11px] text-txt-secondary hover:bg-bg-active">上一个</button>}
        <button type="button" disabled={!answer.trim() || submitting} onClick={() => void submit()}
          className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40">
          {submitting ? '提交中…' : isLast ? '提交并继续' : '下一个'}
        </button>
      </div>
    </div>
  </div>
}

export function moveSlashSelection(current: number, count: number, delta: -1 | 1): number {
  if (count <= 0) return 0
  return (current + delta + count) % count
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function selectedPluginMentions<T extends { id: string }>(value: string, plugins: T[]): T[] {
  return plugins.filter((plugin) =>
    new RegExp(`(^|\\s)@${escapeRegExp(plugin.id)}(?=\\s|$)`, 'i').test(value))
}

export function removePluginMention(value: string, id: string): string {
  return value
    .replace(new RegExp(`(^|\\s)@${escapeRegExp(id)}(?=\\s|$)`, 'i'), '$1')
    .replace(/\s{2,}/g, ' ')
    .trimStart()
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
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-txt-secondary hover:bg-bg-raised"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-white">
          {active.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="max-w-[150px] truncate" title={`${active.name} · ${active.model}`}>{active.name}</span>
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
