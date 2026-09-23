import {
  useRef,
  useEffect,
  useState,
  type KeyboardEvent,
  type ClipboardEvent,
  type DragEvent,
  type ChangeEvent,
  type SetStateAction
} from 'react'
import { App as AntdApp } from 'antd'
import { Sender } from '@ant-design/x'
import type { SenderRef } from '@ant-design/x/es/sender'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { EMPTY_DRAFT, useUiStore, type InputDraft } from '../../stores/uiStore'
import type { ReasoningEffort, Attachment, UserInputRequest } from '@shared/types'
import { supportsImageInput } from '@shared/modelCapabilities'
import { IconButton } from '../ui'
import { Icon } from '../ui/icons'
import { fileToImageAttachment, fileToDocumentAttachment, isImageFile, isDocumentFile } from '../../lib/image'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { stepInputHistory, type InputHistoryState } from './inputHistory'
import { useSkillStore } from '../../stores/skillStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer'

/**
 * 输入框最大高度约束。迁移前是 `max-h-[200px]` + 手动 autosize；
 * Sender 用 `autoSize.maxRows` 表达行数，按 22px 行高折算 9 行 ≈ 198px，
 * 因此这里保留 `MAX_ROWS` 与 `max-h-[200px]` 两道约束（文档 8.4）。
 */
const MAX_ROWS = 9
const EFFORT_LABEL: Record<ReasoningEffort, string> = { low: '低', medium: '中', high: '高' }
const EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high']
type ProcessingFile = InputDraft['processingFiles'][number]

function formatBytes(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 输入区（阶段 C · 设计文档 7.3）。
 *
 * 输入框外壳迁移到 Ant Design X 的**受控** `Sender`：
 *
 * - `value` / `onChange` 仍由本组件持有，`onSubmit` 直接调用既有 `doSend`
 *   （`doSend` 内部仍是 `chatStore.send(sessionId, content, attachments)`）；
 * - Enter 发送 / Shift+Enter 换行交给 Sender 的 `submitType="enter"` 承担，
 *   本组件**不再**自己处理 Enter，避免一次回车触发两次发送；
 * - 发送/停止按钮改用 Sender 的 `SendButton` / `LoadingButton`，
 *   它们的禁用与取消逻辑仍接到本组件：`disabled={!canSend}`、`onCancel=stop`；
 * - 附件、解析中状态、插件 mention 走 `header` 插槽，
 *   模型选择与附件入口走 `footer` 插槽 —— 位置与迁移前一致；
 * - 仍然保留自定义能力：`/Skill` 与 `@插件` 菜单（带键盘导航）、
 *   输入历史（↑/↓）、粘贴/拖拽文件、文件选择、用户补充问题卡片。
 *
 * 关键实现细节（依据 `@ant-design/x/es/sender/components/TextArea.js`）：
 * Sender 内部的 Enter 提交只看 `onKeyDown` 的**返回值是否为 false**，
 * 不看 `preventDefault()`。因此菜单里用 Enter 选中时，本组件必须
 * `return false`，否则会同时触发一次发送。
 */
export function ChatInput({ sessionId }: { sessionId: string }): JSX.Element {
  const { message: messageApi } = AntdApp.useApp()
  const { value, attachments, processingFiles } = useUiStore((state) => state.drafts[sessionId] ?? EMPTY_DRAFT)
  const updateStoredDraft = useUiStore((state) => state.updateDraft)
  const updateDraft = <K extends keyof InputDraft>(key: K, action: SetStateAction<InputDraft[K]>): void => {
    updateStoredDraft(sessionId, (draft) => {
      const previous = draft[key]
      const next = typeof action === 'function'
        ? (action as (value: InputDraft[K]) => InputDraft[K])(previous)
        : action
      return { ...draft, [key]: next }
    })
  }
  const setValue = (next: SetStateAction<string>): void => updateDraft('value', next)
  const setAttachments = (next: SetStateAction<Attachment[]>): void => updateDraft('attachments', next)
  const setProcessingFiles = (next: SetStateAction<ProcessingFile[]>): void => updateDraft('processingFiles', next)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [pluginDismissed, setPluginDismissed] = useState(false)
  const [pluginIndex, setPluginIndex] = useState(0)
  const send = useChatStore((s) => s.send)
  const pendingPrompt = useUiStore((s) => s.pendingPrompt)
  const clearPendingPrompt = useUiStore((s) => s.clearPendingPrompt)
  const stop = useChatStore((s) => s.stop)
  const sending = useChatStore((s) => s.sending[sessionId] ?? false)
  const inputRequest = useChatStore((s) => s.inputRequests[sessionId])
  const clearInputRequest = useChatStore((s) => s.clearInputRequest)
  const inputHistory = useChatStore((state) => (state.messages[sessionId] ?? [])
    .filter((message) => message.role === 'user' && message.content.trim())
    .map((message) => message.content))
  const senderRef = useRef<SenderRef>(null)
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

  /*
   * 会话切换时重置临时菜单与历史导航状态；正文与附件按会话保留。
   *
   * 注意顺序：这个 effect 必须排在下面的「待填文本」effect 之前，
   * 否则切换会话时会把刚填好的内容清掉。
   */
  useEffect(() => {
    historyState.current = { index: null, draft: '' }
    setSlashDismissed(false)
    setSlashIndex(0)
    setPluginDismissed(false)
    setPluginIndex(0)
  }, [sessionId])

  /* 注入只属于目标会话。延迟清除让 StrictMode 的两轮 effect 都能读取同一份值。 */
  useEffect(() => {
    if (!pendingPrompt || pendingPrompt.sessionId !== sessionId) return
    setValue(pendingPrompt.text)
    window.setTimeout(() => clearPendingPrompt(pendingPrompt.id), 0)
  }, [sessionId, pendingPrompt, clearPendingPrompt])

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
      // 点击输入框本身不关闭菜单（与迁移前一致，便于继续输入过滤）
      const input = senderRef.current?.inputElement as unknown as Node | undefined
      if (target && target !== input && !slashMenuRef.current?.contains(target)) setSlashDismissed(true)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [slashMenuOpen])

  useEffect(() => {
    if (!pluginMenuOpen) return
    const dismissOutside = (event: PointerEvent): void => {
      const target = event.target as Node | null
      const input = senderRef.current?.inputElement as unknown as Node | undefined
      if (target && target !== input && !pluginMenuRef.current?.contains(target)) setPluginDismissed(true)
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
    const submittedValue = value
    const submittedAttachments = attachments
    const result = await send(sessionId, v, submittedAttachments, undefined, undefined, selectedPlugins.map((plugin) => plugin.id))
    if (!result.ok) {
      showNotice(result.error.message, 'error')
      return
    }
    updateStoredDraft(sessionId, (draft) => {
      const submittedIds = new Set(submittedAttachments.map((attachment) => attachment.id))
      return {
        ...draft,
        value: draft.value === submittedValue ? '' : draft.value,
        attachments: draft.attachments.filter((attachment) => !submittedIds.has(attachment.id))
      }
    })
    historyState.current = { index: null, draft: '' }
  }

  /** 菜单选中后把光标放回输入框末尾（迁移前由 autosize + setSelectionRange 完成） */
  const focusInputAtEnd = (next: string): void => {
    requestAnimationFrame(() => {
      const input = senderRef.current?.inputElement as HTMLTextAreaElement | undefined
      if (!input) return
      input.focus()
      input.setSelectionRange(next.length, next.length)
    })
  }

  const chooseSlashSkill = (index: number): void => {
    const skill = slashSkills[index]
    if (!skill) return
    const next = `/${skill.name} `
    setValue(next)
    setSlashDismissed(true)
    historyState.current = { index: null, draft: next }
    focusInputAtEnd(next)
  }

  const choosePlugin = (index: number): void => {
    const plugin = mentionPlugins[index]
    if (!plugin || !pluginMatch) return
    const start = pluginMatch.index + pluginMatch[0].lastIndexOf('@')
    const next = `${value.slice(0, start)}@${plugin.id} `
    setValue(next)
    setPluginDismissed(true)
    historyState.current = { index: null, draft: next }
    focusInputAtEnd(next)
  }

  const removePlugin = (id: string): void => {
    const next = removePluginMention(value, id)
    setValue(next)
    setPluginDismissed(true)
    historyState.current = { index: null, draft: next }
  }

  /**
   * 只处理「菜单键盘导航」与「输入历史」。
   *
   * Enter 发送已交给 Sender 的 `submitType="enter"`；这里唯一需要
   * 干预的是菜单打开时的 Enter/Tab：必须 `return false`，
   * 否则 Sender 会在选中菜单项的同一次回车里再发一次消息。
   */
  const onKeyDown = (e: KeyboardEvent): void | false => {
    if (slashMenuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((current) => moveSlashSelection(current, slashSkills.length, e.key === 'ArrowDown' ? 1 : -1))
        return false
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        chooseSlashSkill(slashIndex)
        return false
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return false
      }
    }
    if (pluginMenuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPluginIndex((current) => moveSlashSelection(current, mentionPlugins.length, e.key === 'ArrowDown' ? 1 : -1))
        return false
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        choosePlugin(pluginIndex)
        return false
      }
      if (e.key === 'Escape') { e.preventDefault(); setPluginDismissed(true); return false }
    }
    const input = e.currentTarget as HTMLTextAreaElement
    const atFirstLine = input.selectionStart <= value.indexOf('\n') || !value.includes('\n')
    const lastBreak = value.lastIndexOf('\n')
    const atLastLine = input.selectionEnd > lastBreak
    if (!e.altKey && !e.ctrlKey && !e.metaKey &&
        ((e.key === 'ArrowUp' && atFirstLine) || (e.key === 'ArrowDown' && atLastLine))) {
      const direction = e.key === 'ArrowUp' ? 'previous' : 'next'
      const next = stepInputHistory(inputHistory, value, historyState.current, direction)
      if (next.value !== value || next.state.index !== historyState.current.index) {
        e.preventDefault()
        historyState.current = next.state
        setValue(next.value)
        focusInputAtEnd(next.value)
      }
    }
    return undefined
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

  /* 附件、解析中状态与插件 mention：Sender 的 header 插槽（文档 7.3） */
  const headerNode = (selectedPlugins.length > 0 || images.length > 0 || files.length > 0 || processingFiles.length > 0) ? (
    <div className="space-y-2 px-2 pt-2">
      {selectedPlugins.length > 0 && <div className="flex flex-wrap gap-1.5">
        {selectedPlugins.map((plugin) => <span key={plugin.id}
          className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-accent/30 bg-accent-dim/15 px-2 py-1 text-[14px] text-txt-secondary">
          <Icon.Brain size={11} className="shrink-0 text-accent" />
          <span className="truncate">{plugin.name}</span>
          <button type="button" aria-label={`移除插件 ${plugin.name}`} onClick={() => removePlugin(plugin.id)}
            className="ml-0.5 text-txt-muted hover:text-txt-primary"><Icon.X size={10} /></button>
        </span>)}
      </div>}
      {(images.length > 0 || files.length > 0 || processingFiles.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {processingFiles.map((file) => (
            <div
              key={file.id}
              className="flex max-w-[220px] items-center gap-2 rounded-md border border-border bg-bg-raised px-2 py-1.5"
              aria-live="polite"
            >
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
              <span className="min-w-0 truncate text-[14px] text-txt-secondary" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 text-[14px] text-txt-muted">
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
              <span className="min-w-0 flex-1 truncate text-[14px] text-txt-secondary" title={a.name}>
                {a.name}
              </span>
              <span className="shrink-0 text-[14px] text-txt-muted">{formatBytes(a.meta?.sizeBytes as number | undefined)}</span>
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
    </div>
  ) : null

  return (
    <div className="shrink-0 px-4 pb-2 pt-3" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="relative mx-auto max-w-[820px]">
        {inputRequest && <UserInputCard request={inputRequest} onResolved={() => {
          clearInputRequest(sessionId, inputRequest.id)
        }} />}
        {/*
          描边与焦点态留在外层容器上：Sender 自身的 `-main` 只提供内边距与
          布局，把边框/背景/焦点色放在这里可以完全复用既有令牌，
          不必和组件库的 CSS-in-JS 规则比优先级（文档第 13 节的风险应对）。
        */}
        <div className="rounded-xl border border-border bg-bg-panel transition-colors focus-within:border-accent">
          <Sender
            ref={senderRef}
            value={value}
            onChange={(next) => {
              setValue(next)
              // 用户开始编辑：待填文本已完成使命，清掉以免污染后续会话
              if (pendingPrompt !== undefined) clearPendingPrompt(pendingPrompt.id)
              setSlashDismissed(false)
              setSlashIndex(0)
              setPluginDismissed(false)
              setPluginIndex(0)
              historyState.current = { index: null, draft: next }
            }}
            onSubmit={() => void doSend()}
            onCancel={() => void stop(sessionId)}
            loading={sending}
            disabled={Boolean(inputRequest)}
            placeholder={inputRequest ? '请先回答上方问题…' : '向 ASTRYVE 发送消息...'}
            /* Enter 发送 / Shift+Enter 换行由 Sender 承担，与迁移前规则一致 */
            submitType="enter"
            autoSize={{ minRows: 1, maxRows: MAX_ROWS }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            header={headerNode}
            /* suffix=false：默认操作区藏掉，发送/停止放在 footer 的工具条里 */
            suffix={false}
            classNames={{
              root: 'chat-input-sender',
              input:
                'chat-input-textarea max-h-[200px] text-[14px] leading-[22px] text-txt-primary placeholder:text-txt-muted'
            }}
            /* Sender 自带的边框/阴影由外层容器统一接管 */
            styles={{
              root: {
                border: 'none',
                boxShadow: 'none',
                background: 'transparent'
              }
            }}
            footer={(_actionNode, { components }) => (
              <div className="chat-input-toolbar flex min-w-0 items-center gap-1.5">
                <ModelSelector />
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <IconButton
                    icon={<Icon.Paperclip size={16} />}
                    label="附件（PDF/Word/Excel/CSV）"
                    onClick={() => docRef.current?.click()}
                  />
                  <IconButton
                    icon={<Icon.Image size={16} />}
                    label="图片（粘贴 / 拖拽 / 选择）"
                    onClick={() => imgRef.current?.click()}
                  />
                  {sending ? (
                    <components.LoadingButton aria-label="停止生成" />
                  ) : (
                    <components.SendButton aria-label="发送" disabled={!canSend} />
                  )}
                </div>
              </div>
            )}
          />
        </div>
        {slashMenuOpen && (
          <div ref={slashMenuRef} role="listbox" aria-label="Skill 快捷指令"
            className="absolute bottom-full left-2 right-2 z-40 mb-2 overflow-hidden rounded-lg border border-border bg-bg-raised shadow-2xl">
            <div className="border-b border-border px-3 py-2 text-[14px] text-txt-muted">快捷指令 · 选择 Skill</div>
            {slashSkills.map((skill, index) => (
              <button key={skill.id} type="button" role="option" aria-selected={index === slashIndex}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${index === slashIndex ? 'bg-bg-active' : 'hover:bg-bg-active'}`}
                onMouseEnter={() => setSlashIndex(index)} onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseSlashSkill(index)}>
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-dim/25 text-accent"><Icon.Brain size={13} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-txt-primary">/{skill.name}</span>
                  <span className="block truncate text-[14px] text-txt-muted">{skill.displayName} · {skill.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {pluginMenuOpen && (
          <div ref={pluginMenuRef} role="listbox" aria-label="插件快捷选择"
            className="absolute bottom-full left-2 right-2 z-40 mb-2 overflow-hidden rounded-lg border border-border bg-bg-raised shadow-2xl">
            <div className="border-b border-border px-3 py-2 text-[14px] text-txt-muted">@ 插件 · 仅本次任务使用</div>
            {mentionPlugins.map((plugin, index) => (
              <button key={plugin.id} type="button" role="option" aria-selected={index === pluginIndex}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${index === pluginIndex ? 'bg-bg-active' : 'hover:bg-bg-active'}`}
                onMouseEnter={() => setPluginIndex(index)} onMouseDown={(event) => event.preventDefault()}
                onClick={() => choosePlugin(index)}>
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-dim/25 text-accent"><Icon.Brain size={13} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-txt-primary">@{plugin.id}</span>
                  <span className="block truncate text-[14px] text-txt-muted">{plugin.name}{plugin.version ? ` · ${plugin.version}` : ''} · {plugin.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 text-center text-[14px] text-txt-muted">
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
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-txt-primary">{question.header || 'AI 需要你的选择'}</span>
      <span className="text-[14px] text-txt-muted">{index + 1}/{request.questions.length}</span>
    </div>
    <div className="px-3 py-2.5">
      <p className="mb-2 text-[14px] leading-[22px] text-txt-primary">{question.question}</p>
      {question.options?.length ? <div className="mb-2 grid gap-1.5 sm:grid-cols-2">
        {question.options.map((option, optionIndex) => <button key={option.label} type="button" onClick={() => setAnswer(option.label)}
          className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${answer === option.label
            ? 'border-accent bg-accent-dim/20 text-txt-primary' : 'border-border bg-bg-panel text-txt-secondary hover:border-border-strong'}`}>
          <span className="flex items-center gap-1.5 text-[14px] font-medium">
            <span>{String.fromCharCode(65 + optionIndex)}. {option.label}</span>
            {option.recommended && <span className="rounded bg-accent-dim/30 px-2 py-0.5 text-[14px] font-medium text-accent">推荐</span>}
          </span>
          {option.description && <span className="mt-0.5 block text-[14px] leading-[20px] text-txt-muted">{option.description}</span>}
        </button>)}
      </div> : null}
      <textarea rows={2} value={answer} onChange={(event) => setAnswer(event.target.value)}
        placeholder={question.options?.length ? '也可以填写自定义回答…' : '填写回答…'}
        className="block max-h-24 w-full resize-none rounded-lg border border-border bg-bg-app px-2.5 py-2 text-[14px] leading-[20px] text-txt-primary outline-none placeholder:text-txt-muted focus:border-accent" />
      <div className="mt-2 flex items-center gap-2">
        {error && <span className="min-w-0 flex-1 truncate text-[14px] text-red-300">{error}</span>}
        {!error && <span className="flex-1 text-[14px] text-txt-muted">回答会传回当前任务，AI 将继续执行</span>}
        {index > 0 && <button type="button" disabled={submitting} onClick={() => setIndex((current) => current - 1)}
          className="rounded-md px-2.5 py-1.5 text-[14px] text-txt-secondary hover:bg-bg-active">上一个</button>}
        <button type="button" disabled={!answer.trim() || submitting} onClick={() => void submit()}
          className="rounded-md bg-accent px-3 py-1.5 text-[14px] font-medium text-accent-contrast disabled:opacity-40">
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
  const container = useRef<HTMLDivElement>(null)

  useDismissibleLayer(container, open, () => setOpen(false))

  const active = config?.presets.find((p) => p.id === config.activePresetId)
  const effort = config?.reasoningEffort ?? 'medium'

  if (!config || !active) {
    return (
      <button onClick={() => openSettings()} className="text-[14px] text-txt-muted hover:text-txt-secondary">
        配置模型
      </button>
    )
  }

  return (
    <div ref={container} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-8 items-center gap-2 rounded-lg px-2.5 py-1 text-[14px] transition-colors ${
          open ? 'bg-bg-active text-txt-primary' : 'text-txt-secondary hover:bg-bg-raised hover:text-txt-primary'
        }`}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-accent-contrast">
          {active.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="max-w-[150px] truncate" title={`${active.name} · ${active.model}`}>{active.name}</span>
        <span className="rounded bg-bg-active px-1.5 text-[14px] text-txt-muted">{EFFORT_LABEL[effort]}</span>
        <Icon.ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="模型与推理等级"
          style={{ backgroundColor: 'var(--surface-overlay)' }}
          className="absolute bottom-full left-0 z-40 mb-2 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-strong bg-surface-overlay p-1.5 shadow-overlay"
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[14px] font-medium text-txt-muted">选择模型</div>
          <div className="max-h-[260px] space-y-0.5 overflow-y-auto">
            {config.presets.map((p) => {
              const selected = p.id === config.activePresetId
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    void activate(p.id)
                    setOpen(false)
                  }}
                  className={`flex min-h-[52px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] transition-colors ${
                    selected ? 'bg-accent-soft text-txt-primary' : 'text-txt-secondary hover:bg-bg-active hover:text-txt-primary'
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-semibold ${
                    selected ? 'bg-accent text-accent-contrast' : 'bg-bg-active text-txt-secondary'
                  }`}>
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="mt-0.5 block truncate text-[14px] text-txt-muted">{p.model}</span>
                  </span>
                  {selected && <Icon.Check size={16} className="shrink-0 text-accent" />}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              openSettings()
            }}
            className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-lg border-t border-border px-3 py-2 text-left text-[14px] leading-5 text-accent transition-colors hover:bg-bg-active"
          >
            <Icon.Settings size={16} />
            配置 / 管理模型
          </button>
          <div className="mx-1 mt-1 border-t border-border px-2 pb-1 pt-2 text-[14px] font-medium text-txt-muted">推理等级</div>
          <div className="grid grid-cols-3 gap-1 p-1">
            {EFFORTS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={effort === r}
                onClick={() => {
                  void setReasoning(r)
                  setOpen(false)
                }}
                className={`min-h-9 rounded-lg px-2 py-1 text-[14px] font-medium transition-colors ${
                  effort === r ? 'bg-accent text-accent-contrast' : 'bg-bg-panel text-txt-secondary hover:bg-bg-active hover:text-txt-primary'
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
