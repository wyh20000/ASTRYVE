import { randomUUID } from 'crypto'
import { ipcMain, type WebContents } from 'electron'
import { IPC, EVENTS } from '@shared/ipc'
import type {
  SendMessageInput,
  Message,
  MessageBlock,
  Attachment,
  MessageStatus,
  ModelConfig,
  MessageNotice,
  SourceCitation
} from '@shared/types'
import { getStore } from '../db'
import { buildMockReply } from '../services/mockAgent'
import {
  CONNECT_TIMEOUT_MESSAGE,
  MODEL_RESOURCE_ERROR,
  REQUEST_TIMEOUT_MESSAGE,
  isRetryableStreamError,
  streamChat,
  streamDeepSeekSearch,
  streamSearchChat,
  type ChatMessage,
  type StreamEvent
} from '../services/modelProvider'
import { getModelConfig, getActivePreset } from '../services/modelConfig'
import { extractDocumentText } from '../services/document'
import { fitHistoryToTokenBudget, toChatMessage, injectDocuments } from '../services/history'
import { ok, err } from './result'
import { supportsBuiltInSearch, supportsImageInput } from '@shared/modelCapabilities'
import { extractSourceCitations } from '@shared/searchSources'
import {
  addGenerationTimer,
  beginGeneration,
  cancelGeneration,
  finishGeneration,
  isCurrentGeneration
} from '../services/generationTasks'
import {
  cancelTasksForSession,
  createProjectTask,
  getTaskRuntime,
  getToolRegistry,
  shouldUseProjectAgent
} from '../services/agent/taskRuntimeManager'
import { runToolCallingLoop } from '../services/agent/toolCallingLoop'
import { getWorkspaceService, restoreSessionWorkspace } from '../services/agent/workspaceManager'
import { buildCodingSystemPrompt } from '../services/agent/codingPrompt'
import {
  appendToolTimelineText,
  createToolTimeline,
  resetToolTimeline,
  updateToolTimeline
} from '../services/agent/toolTimeline'
import {
  assertTrustedIpcSender,
  validateSendMessageInput,
  validateSessionId,
  validationErrorMessage
} from './validation'

export function registerMessageIpc(): void {
  ipcMain.handle(IPC.message.list, async (event, sessionId: string) => {
    try {
      assertTrustedIpcSender(event)
      validateSessionId(sessionId)
      if (!(await getStore().getSession(sessionId))) return err('NOT_FOUND', '会话不存在')
      return ok(await getStore().listMessages(sessionId))
    } catch (e) {
      return err('INVALID_INPUT', validationErrorMessage(e))
    }
  })

  ipcMain.handle(IPC.message.send, async (event, input: SendMessageInput) => {
    try {
      assertTrustedIpcSender(event)
      input = validateSendMessageInput(input)
      if (!(await getStore().getSession(input.sessionId))) return err('NOT_FOUND', '会话不存在')
      const hasImages = (input.attachments ?? []).some((attachment) => attachment.kind === 'image')
      const activeModel = getActivePreset()
      if (hasImages && (!activeModel || !supportsImageInput(activeModel))) {
        return err('VISION_UNSUPPORTED', '信息不能发送，此模型无法进行图片处理')
      }
      // 图片保留 base64；文档在主进程提取文本，剥离原始 base64（避免落库膨胀）
      const { stored, docTexts } = await prepareAttachments(input.attachments ?? [])
      const user = await getStore().insertMessage({
        sessionId: input.sessionId,
        role: 'user',
        content: input.content,
        attachments: stored
      })
      await autoTitle(input.sessionId, input.content)
      await getStore().touchSession(input.sessionId)
      // 触发回复（配置了模型则调用真实流式，否则回退 Mock）
      void runReply(event.sender, input.sessionId, stored, docTexts, input.search === true)
      return ok(user)
    } catch (e) {
      return err('INVALID_INPUT', validationErrorMessage(e))
    }
  })

  ipcMain.handle(IPC.message.stop, (event, sessionId: string) => {
    try {
      assertTrustedIpcSender(event)
      validateSessionId(sessionId)
      const generationStopped = cancelGeneration(sessionId, 'user')
      const taskStopped = cancelTasksForSession(sessionId, 'user') > 0
      return ok({ stopped: generationStopped || taskStopped })
    } catch (e) {
      return err('STOP_ERR', String(e))
    }
  })
}

/** 处理附件：文档在主进程提取文本，剥离原始 base64；返回可落库的附件 + 文档文本 */
async function prepareAttachments(attachments: Attachment[]): Promise<{
  stored: Attachment[]
  docTexts: string[]
}> {
  const stored: Attachment[] = []
  const docTexts: string[] = []
  for (const a of attachments) {
    if (a.kind === 'image') {
      stored.push(a)
    } else if (a.kind === 'file') {
      try {
        const { text, charCount } = await extractDocumentText(a.name, a.dataRef)
        stored.push({
          id: a.id,
          kind: 'file',
          name: a.name,
          contentType: a.contentType,
          dataRef: '',
          meta: { ...(a.meta ?? {}), parsed: true, charCount }
        })
        docTexts.push(`[文档：${a.name}]\n${text}`)
      } catch (e) {
        stored.push({
          id: a.id,
          kind: 'file',
          name: a.name,
          contentType: a.contentType,
          dataRef: '',
          meta: { ...(a.meta ?? {}), parsed: false, error: String((e as Error)?.message ?? e) }
        })
        docTexts.push(`[文档：${a.name} 解析失败]`)
      }
    }
  }
  return { stored, docTexts }
}

async function runReply(
  wc: WebContents,
  sessionId: string,
  attachments: Attachment[],
  docTexts: string[],
  search: boolean
): Promise<void> {
  const task = beginGeneration(sessionId, wc.id)
  const cfg = getModelConfig()
  const preset = getActivePreset()
  if (!preset || !preset.apiKey || !preset.baseUrl || !preset.model) {
    scheduleMockReply(wc, sessionId, task)
    return
  }
  const vision = attachments.some((a) => a.kind === 'image')
  const useSearch = search && supportsBuiltInSearch(preset.provider) && !vision
  const projectEligible = !vision && !search
  let useProjectAgent = false
  let agentTaskId: string | undefined
  let agentWorkspaceRoot: string | undefined
  let agentExecutionEnvironment: 'local' | 'docker' | undefined
  try {
    if (projectEligible) {
      const session = await getStore().getSession(sessionId)
      await restoreSessionWorkspace(sessionId, session?.projectPath)
      useProjectAgent = shouldUseProjectAgent(sessionId)
    }
    if (useProjectAgent) {
      cancelTasksForSession(sessionId, 'replaced')
      try {
        const agentTask = await createProjectTask(sessionId, wc.id)
        agentTaskId = agentTask.id
        agentWorkspaceRoot = getWorkspaceService().getGrant(agentTask.workspaceId)?.rootPath
        agentExecutionEnvironment = agentTask.environment
      } catch (error) {
        sendMessageNotice(wc, {
          id: randomUUID(), sessionId, level: 'error',
          message: error instanceof Error ? error.message : '项目任务无法启动'
        })
        return
      }
    }
    await runModelReply(
      wc,
      preset,
      cfg.reasoningEffort,
      sessionId,
      vision,
      docTexts,
      useSearch,
      task.controller.signal,
      agentTaskId,
      agentWorkspaceRoot,
      agentExecutionEnvironment
    )
  } finally {
    finishGeneration(sessionId, task)
  }
}

/** Agent 系统提示：通用助手，具备识图/文档/数据分析/文本处理能力 */
const AGENT_SYSTEM_PROMPT = [
  '你是一个专业的 AI 智能助手，具备识图、文档阅读、数据分析与通用文本处理能力。',
  '回答要求：',
  '- 使用简体中文，简洁、准确、结构清晰（适当使用 markdown 标题 / 列表 / 表格）。',
  '- 分析图片时描述其内容并回答相关问题；分析文档或表格时先理解数据再作答。',
  '- 需要给出代码时，将代码放在 markdown 代码块并标注语言。',
  '- 使用外部资料或联网信息时，必须在相关结论后给出可点击的 Markdown 来源链接。',
  '- 不编造事实；不确定时如实说明。'
].join('\n')

async function buildHistory(
  sessionId: string,
  _contextMessages: number,
  vision: boolean,
  docTexts: string[],
  contextTokens: number,
  coding = false,
  workspaceRoot?: string,
  executionEnvironment?: 'local' | 'docker'
): Promise<ChatMessage[]> {
  const msgs = await getStore().listMessages(sessionId)
  const history: ChatMessage[] = msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .filter((m) => m.content.trim().length > 0 || (m.attachments ?? []).length > 0)
    .map((m) => toChatMessage(m, vision))
  const systemPrompt = coding
    ? `${AGENT_SYSTEM_PROMPT}\n\n${buildCodingSystemPrompt(workspaceRoot, executionEnvironment)}`
    : AGENT_SYSTEM_PROMPT
  const combined = [{ role: 'system' as const, content: systemPrompt }, ...history]
  injectDocuments(combined, docTexts)
  return fitHistoryToTokenBudget(combined, coding ? Math.max(1_000, Math.floor(contextTokens * 0.55)) : contextTokens)
}

async function runModelReply(
  wc: WebContents,
  preset: NonNullable<ReturnType<typeof getActivePreset>>,
  reasoningEffort: ModelConfig['reasoningEffort'],
  sessionId: string,
  vision: boolean,
  docTexts: string[],
  search: boolean,
  signal: AbortSignal,
  agentTaskId?: string,
  agentWorkspaceRoot?: string,
  agentExecutionEnvironment?: 'local' | 'docker'
): Promise<void> {
  const id = randomUUID()
  const timestamp = Date.now()
  let reasoning = ''
  let content = ''
  let sources: SourceCitation[] = []
  const timeline = createToolTimeline()
  let activity = ''
  let pendingPersist: Message | null = null
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let persistChain: Promise<void> = Promise.resolve()
  let hasPersisted = false

  const persistNow = async (): Promise<void> => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    const msg = pendingPersist
    pendingPersist = null
    if (!msg) return
    persistChain = persistChain.then(async () => {
      if (signal.aborted && String(signal.reason ?? '') !== 'user') return
      await getStore().upsertMessage(msg)
      hasPersisted = true
    })
    await persistChain
  }

  const queuePersist = async (msg: Message, force: boolean): Promise<void> => {
    pendingPersist = msg
    if (force || !hasPersisted) {
      await persistNow()
      return
    }
    if (!persistTimer) {
      persistTimer = setTimeout(() => {
        persistTimer = null
        void persistNow().catch((e) => console.warn('[model] throttled persist failed:', e))
      }, 200)
    }
  }

  const emit = async (status: MessageStatus): Promise<void> => {
    const blocks: MessageBlock[] = []
    const thinking = [reasoning, activity].filter(Boolean).join('\n\n')
    if (thinking) blocks.push({ kind: 'thinking', content: thinking })
    if (agentTaskId) blocks.push(...timeline.blocks)
    else if (content) blocks.push({ kind: 'text', content })
    if (sources.length) blocks.push({ kind: 'sources', sources })
    const msg: Message = {
      id,
      sessionId,
      role: 'assistant',
      content,
      blocks: blocks.length ? blocks : undefined,
      status,
      timestamp
    }
    if (!wc.isDestroyed()) wc.send(EVENTS.messageStreamed, msg)
    await queuePersist(msg, status !== 'streaming')
  }

  await emit('streaming')
  const history = await buildHistory(
    sessionId,
    preset.contextMessages,
    vision,
    docTexts,
    preset.contextTokens ?? 128_000,
    Boolean(agentTaskId),
    agentWorkspaceRoot,
    agentExecutionEnvironment
  )
  const runtime = {
    provider: preset.provider,
    baseUrl: preset.baseUrl,
    apiKey: preset.apiKey,
    model: preset.model,
    reasoningEffort,
    vision,
    signal
  }
  const onEvent = async (ev: StreamEvent): Promise<void> => {
    if (ev.reasoning) reasoning += ev.reasoning
    if (ev.content) {
      content += ev.content
      if (agentTaskId) appendToolTimelineText(timeline, ev.content)
      activity = ''
    }
    if (ev.activity !== undefined) activity = ev.activity
    if (ev.sources) {
      const merged = new Map(sources.map((source) => [source.url, source]))
      for (const source of ev.sources) merged.set(source.url, source)
      sources = [...merged.values()].slice(0, 12)
    }
    if (ev.done) return
    await emit('streaming')
  }

  let retried = false
  let useSearch = search
  let searchFallbackUsed = false
  while (true) {
    try {
      if (agentTaskId) {
        const result = await runToolCallingLoop({
          taskRuntime: getTaskRuntime(),
          registry: getToolRegistry(),
          taskId: agentTaskId,
          model: runtime,
          messages: history,
          onEvent,
          onToolActivity: async (tool) => {
            const baseTitle = describeToolActivity(tool.toolName, tool.args, tool.result)
            const failure = tool.status === 'completed' && tool.ok === false
              ? toolFailureDescription(tool.result)
              : ''
            updateToolTimeline(
              timeline,
              tool.callId,
              failure ? `${baseTitle}（未完成：${failure}）` : baseTitle,
              tool.status === 'completed' && tool.ok === true
            )
            await emit('streaming')
          },
          maxToolResultChars: Math.max(20_000, Math.min(400_000, Math.floor((preset.contextTokens ?? 128_000) * 1.4)))
        })
        if (result.status === 'failed') {
          const failureMessage = result.error?.message ?? 'Coding 任务执行失败'
          if (!content.trim()) {
            appendToolTimelineText(timeline, `本次执行未完成：${failureMessage}。请重试。`)
          }
          await emit('error')
          sendMessageNotice(wc, {
            id: randomUUID(), sessionId, level: 'error',
            message: failureMessage
          })
          return
        }
      } else if (useSearch) {
        if (preset.provider === 'deepseek') await streamDeepSeekSearch(runtime, history, onEvent)
        else await streamSearchChat(runtime, history, onEvent)
      }
      else await streamChat(runtime, history, onEvent)
      if (useSearch) {
        const extracted = extractSourceCitations(content)
        const merged = new Map(sources.map((source) => [source.url, source]))
        for (const source of extracted) merged.set(source.url, source)
        sources = [...merged.values()].slice(0, 12)
      }
      await emit('done')
      return
    } catch (e) {
      if (signal.aborted) {
        if (persistTimer) clearTimeout(persistTimer)
        const reason = String(signal.reason ?? 'user')
        if (reason === 'user') {
          await emit('done')
          sendMessageNotice(wc, {
            id: randomUUID(),
            sessionId,
            level: 'warning',
            message: '已停止生成'
          })
        }
        return
      }
      if (useSearch && !searchFallbackUsed) {
        searchFallbackUsed = true
        useSearch = false
        reasoning = ''
        content = ''
        resetToolTimeline(timeline)
        sources = []
        activity = ''
        console.warn('[model] web search failed, falling back to ordinary chat')
        sendMessageNotice(wc, {
          id: randomUUID(),
          sessionId,
          level: 'warning',
          message: '联网搜索失败，已自动切换为普通回答'
        })
        await emit('streaming')
        continue
      }

      const retryable = isRetryableStreamError(e)
      // 尚未产生最终正文时允许重试一次；清空首轮思考，避免重试后重复展示。
      if (!useSearch && retryable && !content && !retried) {
        retried = true
        reasoning = ''
        console.warn('[model] stream interrupted before content, retrying once')
        await emit('streaming')
        continue
      }

      const detail = (e as Error)?.message ?? '网络错误'
      console.warn('[model] chat error:', detail) // 不打印 prompt / 响应内容
      if (!content.trim()) {
        const placeholder = modelErrorMessage(detail, retryable, retried, false)
        if (agentTaskId) appendToolTimelineText(timeline, `本次执行未完成：${placeholder}。请重试。`)
        else content = `本次回答未完成：${placeholder}。请重试。`
      }
      await emit('error')
      sendMessageNotice(wc, {
        id: randomUUID(),
        sessionId,
        level: 'error',
        message: modelErrorMessage(detail, retryable, retried, content.length > 0)
      })
      return
    }
  }
}

function describeToolActivity(toolName: string, args: unknown, result?: unknown): string {
  const input = args && typeof args === 'object' && !Array.isArray(args)
    ? args as Record<string, unknown> : {}
  const clean = (value: unknown): string => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 100) : ''
  if (toolName === 'process.run') {
    const executable = clean(input.executable) || '命令'
    const argv = Array.isArray(input.args) ? input.args.slice(0, 4).map(clean).filter(Boolean).join(' ') : ''
    return `等待批准并运行：${executable}${argv ? ` ${argv}` : ''}`
  }
  if (toolName === 'process.startService') {
    const output = result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown> : {}
    const pid = Number.isSafeInteger(output.pid) ? `PID ${output.pid}` : '等待启动'
    const ports = Array.isArray(output.expectedPorts)
      ? output.expectedPorts.filter(Number.isSafeInteger).slice(0, 8).join(', ') : ''
    return result
      ? `服务已启动：${pid}${ports ? `，声明端口 ${ports}` : ''}`
      : `等待批准并启动服务：${clean(input.executable) || '命令'}`
  }
  if (toolName === 'process.stop') return result ? '服务已停止' : '停止任务服务'
  if (toolName === 'workspace.readFile') return `读取文件：${clean(input.path) || '项目文件'}`
  if (toolName === 'workspace.searchText') return `搜索正文：${clean(input.query) || '关键词'}`
  if (toolName === 'workspace.findFiles') return `查找文件：${clean(input.query) || '文件名'}`
  if (toolName === 'workspace.listFiles') return `查看目录：${clean(input.path) || '项目根目录'}`
  if (toolName.startsWith('git.')) return `查看 Git：${toolName.slice(4)}`
  return `使用工具：${toolName.slice(0, 100)}`
}

function toolFailureDescription(result: unknown): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '工具返回错误'
  const error = (result as { error?: unknown }).error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return '工具返回错误'
  const message = (error as { message?: unknown }).message
  return typeof message === 'string'
    ? message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120)
    : '工具返回错误'
}

function modelErrorMessage(detail: string, retryable: boolean, retried: boolean, hasContent: boolean): string {
  if (detail === MODEL_RESOURCE_ERROR) return '模型当前资源不足，请稍后再试'
  if (detail === CONNECT_TIMEOUT_MESSAGE) return '连接模型超时，请检查网络或模型地址'
  if (detail === REQUEST_TIMEOUT_MESSAGE) return '模型响应超时，已停止本次生成'
  if (retryable && hasContent) return '模型连接中断，已保留生成内容；可发送“继续”继续分析'
  if (retryable && retried) return '模型连接中断，自动重试后仍未恢复，请稍后再试'
  if (retryable) return '模型连接中断，请稍后再试'
  return '模型请求失败，请检查模型配置或稍后再试'
}

function sendMessageNotice(wc: WebContents, notice: MessageNotice): void {
  if (!wc.isDestroyed()) wc.send(EVENTS.messageNotice, notice)
}

function scheduleMockReply(
  wc: WebContents,
  sessionId: string,
  task: ReturnType<typeof beginGeneration>
): void {
  const steps = buildMockReply(sessionId)
  for (const [index, step] of steps.entries()) {
    addGenerationTimer(task, () => {
      if (wc.isDestroyed() || !isCurrentGeneration(sessionId, task)) return
      void getStore()
        .upsertMessage(step.message)
        .then(() => {
          wc.send(EVENTS.messageStreamed, step.message)
          if (index === steps.length - 1) finishGeneration(sessionId, task)
        })
        .catch((e) => console.warn('[mock] upsert failed:', e))
    }, step.delayMs)
  }
}
/** 由首条用户消息生成简短会话标题 */
function deriveTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0]?.replace(/\s+/g, ' ') ?? ''
  const title = firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine
  return title || '新对话'
}

/** 若会话标题为空，则用首条消息自动命名 */
async function autoTitle(sessionId: string, content: string): Promise<void> {
  try {
    const session = await getStore().getSession(sessionId)
    if (session && (!session.title || session.title.trim().length === 0)) {
      await getStore().renameSession(sessionId, deriveTitle(content))
    }
  } catch {
    /* 标题生成失败不影响发送 */
  }
}
