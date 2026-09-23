import { randomUUID } from 'crypto'
import { ipcMain, type WebContents } from 'electron'
import { IPC, EVENTS } from '@shared/ipc'
import type {
  SendMessageInput,
  Message,
  MessageCursor,
  MessageBlock,
  Attachment,
  MessageStatus,
  GenerationFinishReason,
  ModelConfig,
  MessageNotice,
  SourceCitation,
  SkillMetadata,
  UserInputResponse
} from '@shared/types'
import { getStore } from '../db'
import { getArtifactStore, isArtifactRef, materializeMessage } from '../services/artifactStore'
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
import { fitHistoryToTokenBudget, toChatMessage, injectDocuments, selectDocumentPassages } from '../services/history'
import { ok, err } from './result'
import { supportsBuiltInSearch, supportsImageInput } from '@shared/modelCapabilities'
import { extractSourceCitations } from '@shared/searchSources'
import {
  addGenerationTimer,
  beginGeneration,
  cancelGeneration,
  finishGeneration,
  isCurrentGeneration,
  setGenerationCancelHandler,
  updateGenerationSnapshot,
  type GenerationTask
} from '../services/generationTasks'
import {
  cancelTasksForSession,
  createBrowserTask,
  createProjectTask,
  getPatchWorkspaceService,
  getTaskRuntime,
  getToolRegistry,
  shouldUseProjectAgent
} from '../services/agent/taskRuntimeManager'
import { listPlugins } from '../services/agent/pluginManager'
import { resolvePluginSelection } from '../services/agent/pluginConversation'
import { writeAgentAudit } from '../services/agent/taskRuntimeManager'
import { runInteractiveChatLoop, runToolCallingLoop } from '../services/agent/toolCallingLoop'
import { requestUserInput, submitUserInput } from '../services/agent/userInput'
import { getWorkspaceService, restoreSessionWorkspace } from '../services/agent/workspaceManager'
import { buildCodingSystemPrompt, codingReasoningEffort } from '../services/agent/codingPrompt'
import { auditSkillUse, resolveSkills } from '../services/agent/skillManager'
import { composeSkillSystemPrompt, replaceActiveUserRequest } from '../services/agent/skillConversation'
import {
  appendToolTimelineText,
  appendToolTimelineThinking,
  appendToolTimelineImage,
  appendPatchTimeline,
  appendCommandTimeline,
  appendTaskReport,
  createToolTimeline,
  resetToolTimeline,
  settleToolTimeline,
  updateToolTimeline
} from '../services/agent/toolTimeline'
import {
  consumeBrowserScreenshotArtifact
} from '../services/browser/browserTools'
import {
  BROWSER_CONVERSATION_PROMPT,
  browserToolNamesForRequest,
  hasRecentBrowserContext,
  prefersBrowserContinuation,
  prefersBrowserTools
} from '../services/browser/browserConversation'
import { acquireOfficialChromeBrowserLease } from '../services/browser/officialChromeBrowserRuntime'
import {
  assertTrustedIpcSender,
  validateSendMessageInput,
  validateSessionId,
  validationErrorMessage
} from './validation'

export function registerMessageIpc(): void {
  ipcMain.handle(IPC.message.list, async (event, sessionId: string, before?: MessageCursor) => {
    try {
      assertTrustedIpcSender(event)
      validateSessionId(sessionId)
      if (before && (!Number.isSafeInteger(before.timestamp) || before.timestamp < 0 ||
          typeof before.id !== 'string' || before.id.length > 64)) {
        return err('INVALID_INPUT', '消息游标无效')
      }
      if (!(await getStore().getSession(sessionId))) return err('NOT_FOUND', '会话不存在')
      const messages = await getStore().listMessagesPage(sessionId, before, 100)
      return ok(await Promise.all(messages.map(materializeMessage)))
    } catch (e) {
      return err('INVALID_INPUT', validationErrorMessage(e))
    }
  })

  ipcMain.handle(IPC.message.send, async (event, input: SendMessageInput) => {
    try {
      assertTrustedIpcSender(event)
      input = validateSendMessageInput(input)
      if (!(await getStore().getSession(input.sessionId))) return err('NOT_FOUND', '会话不存在')
      const existing = (await getStore().listMessages(input.sessionId))
        .find((message) => message.id === input.clientMessageId && message.role === 'user')
      if (existing) return ok(await materializeMessage(existing))
      const sendKey = `${input.sessionId}:${input.clientMessageId}`
      const activeSend = pendingSends.get(sendKey)
      if (activeSend) return ok(await activeSend)
      const hasImages = (input.attachments ?? []).some((attachment) => attachment.kind === 'image')
      const activeModel = getActivePreset()
      if (hasImages && (!activeModel || !supportsImageInput(activeModel))) {
        return err('VISION_UNSUPPORTED', '信息不能发送，此模型无法进行图片处理')
      }
      if (input.search && hasImages) return err('SEARCH_VISION_UNSUPPORTED', '图片与联网搜索暂不能同时使用')
      if (input.search && !supportsBuiltInSearch(activeModel?.provider)) {
        return err('SEARCH_UNSUPPORTED', '当前模型不支持内置联网搜索')
      }
      if (input.search && ((input.pluginIds?.length ?? 0) > 0 || (input.skillIds?.length ?? 0) > 0 ||
          /^\s*\/[a-z0-9_-]+\b/i.test(input.content))) {
        return err('SEARCH_TOOL_COMBINATION_UNSUPPORTED', '插件或 Skill 与供应商联网搜索暂不能同时使用')
      }
      // 图片与文档正文写入账号级 Artifact Store；数据库只保存引用和元数据。
      const sendPromise = (async (): Promise<Message> => {
        const { stored, docTexts } = await prepareAttachments(input.attachments ?? [])
        const createdAt = Date.now()
        const turn = {
          id: input.clientMessageId,
          sessionId: input.sessionId,
          createdAt,
          text: input.content,
          imageRefs: stored.filter((attachment) => attachment.kind === 'image').map((attachment) => attachment.dataRef),
          documentRefs: stored.filter((attachment) => attachment.kind === 'file')
            .map((attachment) => attachment.meta?.documentRef)
            .filter((ref): ref is string => typeof ref === 'string' && isArtifactRef(ref)),
          skillIds: [...(input.skillIds ?? [])],
          pluginIds: [...(input.pluginIds ?? [])],
          searchRequested: input.search === true
        }
        const user = await getStore().insertMessage({
          id: input.clientMessageId,
          sessionId: input.sessionId,
          role: 'user',
          content: input.content,
          attachments: stored,
          timestamp: createdAt,
          turn
        })
        await autoTitle(input.sessionId, input.content)
        await getStore().touchSession(input.sessionId)
        void runReply(
          event.sender, input.sessionId, input.clientMessageId, createdAt, input.content,
          input.skillIds ?? [], input.pluginIds ?? [], input.search === true, stored, docTexts
        ).catch((error) => console.warn('[message] reply transaction failed:', error))
        return materializeMessage(user)
      })()
      pendingSends.set(sendKey, sendPromise)
      try {
        return ok(await sendPromise)
      } finally {
        pendingSends.delete(sendKey)
      }
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

  ipcMain.handle(IPC.message.respondInput, (event, input: UserInputResponse) => {
    try {
      assertTrustedIpcSender(event)
      return submitUserInput(input, event.sender.id)
        ? ok({ accepted: true })
        : err('INPUT_REQUEST_EXPIRED', '这个问题已失效，请等待 AI 的最新状态')
    } catch (e) {
      return err('INVALID_INPUT', validationErrorMessage(e))
    }
  })
}

const pendingSends = new Map<string, Promise<Message>>()

/** 处理附件：原件和解析文本写入 Artifact Store，消息行仅保存引用。 */
async function prepareAttachments(attachments: Attachment[]): Promise<{
  stored: Attachment[]
  docTexts: string[]
}> {
  const stored: Attachment[] = []
  const docTexts: string[] = []
  for (const a of attachments) {
    if (a.kind === 'image') {
      const artifact = await getArtifactStore().putDataUrl(a.dataRef, 'user')
      stored.push({
        ...a, dataRef: artifact.ref, contentType: artifact.mime,
        meta: { ...a.meta, hash: artifact.hash, sizeBytes: artifact.sizeBytes, source: 'user' }
      })
    } else if (a.kind === 'file') {
      const original = await getArtifactStore().putDataUrl(a.dataRef, 'document-original')
      try {
        const { text, charCount } = await extractDocumentText(a.name, a.dataRef)
        const artifact = await getArtifactStore().putText(text, 'document')
        stored.push({
          id: a.id,
          kind: 'file',
          name: a.name,
          contentType: a.contentType,
          dataRef: original.ref,
          meta: { ...(a.meta ?? {}), parsed: true, charCount, documentRef: artifact.ref,
            hash: original.hash, sizeBytes: original.sizeBytes, source: 'document' }
        })
        docTexts.push(`[文档：${a.name}]\n${text}`)
      } catch (e) {
        stored.push({
          id: a.id,
          kind: 'file',
          name: a.name,
          contentType: a.contentType,
          dataRef: original.ref,
          meta: { ...(a.meta ?? {}), parsed: false, error: String((e as Error)?.message ?? e),
            hash: original.hash, sizeBytes: original.sizeBytes, source: 'document' }
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
  generationId: string,
  userTimestamp: number,
  userRequest: string,
  explicitSkillIds: string[],
  explicitPluginIds: string[],
  searchRequested: boolean,
  attachments: Attachment[],
  docTexts: string[]
): Promise<void> {
  const task = beginGeneration(sessionId, wc.id, generationId)
  const assistantId = randomUUID()
  const waiting: Message = {
    id: assistantId,
    sessionId,
    generationId,
    revision: 0,
    role: 'assistant',
    content: '',
    status: 'waiting',
    timestamp: Math.max(Date.now(), userTimestamp + 1)
  }
  updateGenerationSnapshot(task, waiting)
  setGenerationCancelHandler(task, async (reason, snapshot = waiting) => {
    if (isTerminalStatus(snapshot.status)) return
    if (reason === 'session_deleted') return
    const terminal: Message = {
      ...snapshot,
      status: reason === 'user' ? 'cancelled' : 'interrupted',
      revision: (snapshot.revision ?? 0) + 1,
      finishReason: cancellationFinishReason(reason)
    }
    updateGenerationSnapshot(task, terminal)
    await getStore().upsertMessage(terminal)
    if (!wc.isDestroyed()) wc.send(EVENTS.messageStreamed, await materializeMessage(terminal))
    if (reason === 'user') {
      sendMessageNotice(wc, { id: randomUUID(), sessionId, level: 'warning', message: '已停止生成' })
    }
  })
  if (!wc.isDestroyed()) wc.send(EVENTS.messageStreamed, waiting)
  try {
    await getStore().upsertMessage(waiting)
  } catch (error) {
    await failGenerationSetup(wc, task, '无法保存本次回答')
    finishGeneration(sessionId, task)
    console.warn('[message] assistant shell persist failed:', error)
    return
  }
  const cfg = getModelConfig()
  const preset = getActivePreset()
  if (!preset || !preset.apiKey || !preset.baseUrl || !preset.model) {
    scheduleMockReply(wc, sessionId, task, assistantId)
    return
  }
  const vision = attachments.some((a) => a.kind === 'image')
  const projectEligible = !vision
  let useProjectAgent = false
  let agentTaskId: string | undefined
  let agentWorkspaceId: string | undefined
  let agentWorkspaceRoot: string | undefined
  let agentExecutionEnvironment: 'local' | 'docker' | undefined
  let skillPrompt = ''
  let modelUserRequest = userRequest
  let allowedToolNames: Set<string> | undefined
  let activeSkills: SkillMetadata[] = []
  let skillTrigger: string | undefined
  let selectedPluginIds: string[] = []
  let selectedPluginVersions: Record<string, string | undefined> = {}
  try {
    const session = await getStore().getSession(sessionId)
    const pluginSelection = resolvePluginSelection(userRequest, explicitPluginIds, await listPlugins())
    selectedPluginIds = pluginSelection.pluginIds
    if (pluginSelection.trigger) modelUserRequest = pluginSelection.cleanedRequest
    const browserIntent = projectEligible && !searchRequested && (
      prefersBrowserTools(userRequest) ||
      (prefersBrowserContinuation(userRequest) &&
        hasRecentBrowserContext(await getStore().listMessages(sessionId)))
    )
    if (projectEligible) {
      await restoreSessionWorkspace(sessionId, session?.projectPath)
      const explicitSkill = explicitSkillIds.length > 0 || /^\s*\/[a-z0-9_-]+\b/i.test(userRequest)
      const explicitPlugin = selectedPluginIds.length > 0
      useProjectAgent = shouldUseProjectAgent(sessionId) &&
        (explicitSkill || explicitPlugin || browserIntent || !searchRequested)
    }
    if (useProjectAgent) {
      cancelTasksForSession(sessionId, 'replaced')
      try {
        const agentTask = await createProjectTask(sessionId, wc.id, selectedPluginIds.length ? selectedPluginIds : undefined)
        selectedPluginIds = agentTask.pluginIds ?? []
        selectedPluginVersions = agentTask.pluginVersions ?? {}
        agentTaskId = agentTask.id
        agentWorkspaceId = agentTask.workspaceId
        const grant = getWorkspaceService().getGrant(agentTask.workspaceId)
        agentWorkspaceRoot = grant?.rootPath
        agentExecutionEnvironment = agentTask.environment
        if (grant) {
          const resolved = await resolveSkills(modelUserRequest, explicitSkillIds, grant)
          skillPrompt = resolved.prompt
          modelUserRequest = resolved.cleanedRequest
          allowedToolNames = resolved.allowedToolNames
          if (allowedToolNames) {
            for (const tool of getTaskRuntime().listNativeFunctionTools(agentTask.id)) {
              if (tool.function.name.startsWith('plugin.')) allowedToolNames.add(tool.function.name)
            }
          }
          activeSkills = resolved.skills
          skillTrigger = resolved.trigger
          if (browserIntent) {
            skillPrompt = [skillPrompt, BROWSER_CONVERSATION_PROMPT].filter(Boolean).join('\n\n')
            const browserToolNames = browserToolNamesForRequest(userRequest)
            allowedToolNames ??= new Set(
              getTaskRuntime().listNativeFunctionTools(agentTask.id).map((tool) => tool.function.name)
            )
            for (const name of browserToolNames) allowedToolNames.add(name)
            if (!browserToolNames.has('browser.screenshotElement')) {
              allowedToolNames.delete('browser.screenshotElement')
            }
          }
          auditSkillUse(agentTask.id, agentTask.workspaceId, resolved.skills)
          for (const pluginId of agentTask.pluginIds ?? []) {
            writeAgentAudit({
              id: randomUUID(), timestamp: Date.now(), taskId: agentTask.id,
              workspaceId: agentTask.workspaceId, actor: 'system', action: 'plugin.snapshot', outcome: 'success',
              metadata: {
                pluginId, version: agentTask.pluginVersions?.[pluginId], source: 'installed',
                model: preset.model
              }
            })
          }
        }
      } catch (error) {
        if (agentTaskId) cancelTasksForSession(sessionId, 'skill_setup_failed')
        sendMessageNotice(wc, {
          id: randomUUID(), sessionId, level: 'error',
          message: error instanceof Error ? error.message : '项目任务无法启动'
        })
        await failGenerationSetup(wc, task, error instanceof Error ? error.message : '项目任务无法启动')
        return
      }
    } else if (browserIntent) {
      cancelTasksForSession(sessionId, 'replaced')
      try {
        const agentTask = await createBrowserTask(sessionId, wc.id)
        agentTaskId = agentTask.id
        agentWorkspaceId = agentTask.workspaceId
        agentExecutionEnvironment = agentTask.environment
        allowedToolNames = browserToolNamesForRequest(userRequest)
        skillPrompt = BROWSER_CONVERSATION_PROMPT
      } catch (error) {
        sendMessageNotice(wc, {
          id: randomUUID(), sessionId, level: 'error',
          message: error instanceof Error ? error.message : '浏览器任务无法启动'
        })
        await failGenerationSetup(wc, task, error instanceof Error ? error.message : '浏览器任务无法启动')
        return
      }
    } else if (!searchRequested) {
      try {
        const resolved = await resolveSkills(userRequest, explicitSkillIds)
        skillPrompt = resolved.prompt
        modelUserRequest = resolved.cleanedRequest
        activeSkills = resolved.skills
        skillTrigger = resolved.trigger
        auditSkillUse(`chat-${sessionId}`, 'none', resolved.skills)
      } catch (error) {
        sendMessageNotice(wc, {
          id: randomUUID(), sessionId, level: 'error',
          message: error instanceof Error ? error.message : 'Skill 无法加载'
        })
        await failGenerationSetup(wc, task, error instanceof Error ? error.message : 'Skill 无法加载')
        return
      }
    }
    const useSearch = searchRequested && !vision && !agentTaskId && supportsBuiltInSearch(preset.provider)
    const releaseBrowserLease = agentTaskId ? acquireOfficialChromeBrowserLease() : undefined
    try {
      await runModelReply(
        wc,
        preset,
        useProjectAgent ? codingReasoningEffort(cfg.reasoningEffort, userRequest) : cfg.reasoningEffort,
        sessionId,
        vision,
        docTexts,
        useSearch,
        task.controller.signal,
        agentTaskId,
        agentWorkspaceId,
        agentWorkspaceRoot,
        agentExecutionEnvironment,
        useProjectAgent,
        skillPrompt,
        allowedToolNames,
        modelUserRequest,
        activeSkills,
        skillTrigger,
        selectedPluginIds,
        selectedPluginVersions,
        task,
        assistantId,
        waiting.timestamp
      )
    } finally {
      await releaseBrowserLease?.()
    }
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

export async function buildHistory(
  sessionId: string,
  _contextMessages: number,
  vision: boolean,
  docTexts: string[],
  contextTokens: number,
  coding = false,
  workspaceRoot?: string,
  executionEnvironment?: 'local' | 'docker',
  skillPrompt = '',
  activeRequest?: string
): Promise<ChatMessage[]> {
  const msgs = await getStore().listMessages(sessionId)
  const latestUser = [...msgs].reverse().find((message) => message.role === 'user')
  const history: ChatMessage[] = []
  const includedMessages: Message[] = []
  for (const message of msgs) {
    if (!['user', 'assistant', 'system'].includes(message.role)) continue
    if (!message.content.trim() && !message.attachments?.length &&
        !message.blocks?.some((block) => block.kind === 'toolContext')) continue
    const activeVisualTurn = vision && message.id === latestUser?.id
    history.push(toChatMessage(activeVisualTurn ? await materializeMessage(message) : message, activeVisualTurn))
    includedMessages.push(message)
  }
  const systemPrompt = composeSkillSystemPrompt(
    AGENT_SYSTEM_PROMPT,
    coding ? buildCodingSystemPrompt(workspaceRoot, executionEnvironment) : undefined,
    skillPrompt
  )
  const combined = [{ role: 'system' as const, content: systemPrompt }, ...history]
  replaceActiveUserRequest(combined, activeRequest)
  const documentCandidates = msgs.filter((message) => message.role === 'user' && message.turn?.documentRefs.length)
    .flatMap((message) => (message.attachments ?? [])
      .filter((attachment) => attachment.kind === 'file' && typeof attachment.meta?.documentRef === 'string')
      .map((attachment) => ({ name: attachment.name, ref: attachment.meta!.documentRef as string })))
  const query = activeRequest ?? latestUser?.content ?? ''
  const matching = documentCandidates.filter((candidate) => query.includes(candidate.name))
  const recent = documentCandidates.slice(-3)
  const selected = [...new Map([...matching, ...recent].map((candidate) => [candidate.ref, candidate])).values()].slice(-4)
  const excerpts: string[] = []
  for (const candidate of selected) {
    try {
      const content = await getArtifactStore().readText(candidate.ref)
      excerpts.push(`[已保存文档：${candidate.name}，引用：${candidate.ref}]\n${selectDocumentPassages(content, query, 6_000)}`)
    } catch {
      excerpts.push(`[已保存文档：${candidate.name} 暂时无法读取；不得猜测其内容]`)
    }
  }
  injectDocuments(combined, excerpts.length ? excerpts : docTexts)
  const fitted = fitHistoryToTokenBudget(
    combined, coding ? Math.max(1_000, Math.floor(contextTokens * 0.55)) : contextTokens
  )
  const omittedCount = history.length - (fitted.length - 1)
  if (omittedCount > 0 && typeof fitted[0]?.content === 'string') {
    const sourceIds = includedMessages.slice(0, omittedCount)
      .flatMap((message) => [...(message.turn?.documentRefs ?? []), ...(message.turn?.imageRefs ?? [])])
      .filter(isArtifactRef)
    const summary = [...new Set(sourceIds)].slice(-8).join(', ')
    fitted[0] = {
      ...fitted[0],
      content: `${fitted[0].content}\n\n历史来源摘要：已省略 ${omittedCount} 条较早消息。` +
        (summary ? `省略部分曾包含附件引用 ${summary}。` : '') +
        '引用仅说明来源存在，不代表本轮已重新读取其内容或图片像素。'
    }
  }
  return fitted
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
  agentWorkspaceId?: string,
  agentWorkspaceRoot?: string,
  agentExecutionEnvironment?: 'local' | 'docker',
  codingAgent = false,
  skillPrompt = '',
  allowedToolNames?: ReadonlySet<string>,
  activeRequest?: string,
  activeSkills: SkillMetadata[] = [],
  skillTrigger?: string,
  activePluginIds: string[] = [],
  activePluginVersions: Record<string, string | undefined> = {},
  generationTask?: GenerationTask,
  assistantId?: string,
  assistantTimestamp?: number
): Promise<void> {
  if (!generationTask || !assistantId || assistantTimestamp == null) {
    throw new Error('Generation transaction is missing')
  }
  const id = assistantId
  const timestamp = assistantTimestamp
  let revision = generationTask.snapshot?.revision ?? 0
  let reasoning = ''
  let content = ''
  let sources: SourceCitation[] = []
  const generatedAttachments: Attachment[] = []
  const timeline = createToolTimeline()
  if (activePluginIds.length) {
    timeline.blocks.push({
      kind: 'plugins', model: preset.model,
      plugins: activePluginIds.map((id) => ({ id, version: activePluginVersions[id] }))
    })
  }
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

  const emit = async (status: MessageStatus, finishReason?: GenerationFinishReason): Promise<void> => {
    if (signal.aborted && !isTerminalStatus(status)) return
    const blocks: MessageBlock[] = []
    if (activeSkills.length) blocks.push({ kind: 'skills', trigger: skillTrigger, skills: activeSkills.map((skill) => ({
      name: skill.name, displayName: skill.displayName, source: skill.source, version: skill.version
    })) })
    const thinking = [reasoning, activity].filter(Boolean).join('\n\n')
    if (!agentTaskId && thinking) {
      blocks.push({ kind: 'thinking', content: thinking, done: status !== 'streaming' })
    }
    if (agentTaskId) {
      // 最后一段思考后面可能没有文本/工具块，消息结束时补结算
      if (status !== 'streaming') settleToolTimeline(timeline)
      blocks.push(...timeline.blocks)
      if (activity) blocks.push({ kind: 'thinking', content: activity })
    }
    else if (content) blocks.push({ kind: 'text', content })
    if (sources.length) blocks.push({ kind: 'sources', sources })
    const msg: Message = {
      id,
      sessionId,
      role: 'assistant',
      content,
      blocks: blocks.length ? blocks : undefined,
      status,
      timestamp,
      generationId: generationTask.generationId,
      revision: ++revision,
      finishReason,
      attachments: generatedAttachments.length ? [...generatedAttachments] : undefined
    }
    updateGenerationSnapshot(generationTask, msg)
    await queuePersist(msg, status !== 'streaming' || generatedAttachments.length > 0)
    if (!wc.isDestroyed()) wc.send(EVENTS.messageStreamed, await materializeMessage(msg))
  }

  await emit('streaming')
  const history = await buildHistory(
    sessionId,
    preset.contextMessages,
    vision,
    docTexts,
    preset.contextTokens ?? 128_000,
    codingAgent,
    agentWorkspaceRoot,
    agentExecutionEnvironment,
    skillPrompt,
    activeRequest
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
    if (ev.reasoning) {
      reasoning += ev.reasoning
      if (agentTaskId) appendToolTimelineThinking(timeline, ev.reasoning)
    }
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
        const taskRuntime = getTaskRuntime()
        let activeTool: { toolName: string; args: unknown } | undefined
        const approvals: Array<{ toolName: string; target: string }> = []
        const unsubscribeApprovals = taskRuntime.subscribe((event) => {
          const payload = event.payload as { to?: unknown }
          if (event.taskId === agentTaskId && event.type === 'task.status-changed' &&
              payload.to === 'waiting-approval' && activeTool) {
            approvals.push({ toolName: activeTool.toolName, target: approvalTarget(activeTool.args) })
          }
        })
        let result
        try { result = await runToolCallingLoop({
          taskRuntime,
          registry: getToolRegistry(),
          taskId: agentTaskId,
          model: runtime,
          messages: history,
          onEvent,
          allowedToolNames,
          requireInitialTool: activeSkills.length === 0,
          requestUserInput: (args) => requestUserInput(
            wc, sessionId, args, taskRuntime.getTaskSignal(agentTaskId)
          ),
          onToolActivity: async (tool) => {
            activeTool = tool.status === 'requested' ? { toolName: tool.toolName, args: tool.args } : undefined
            if (tool.toolName.startsWith('plugin.')) {
              const pluginId = activePluginIds.find((id: string) => tool.toolName.startsWith(`plugin.${id}.`)) ?? 'unknown'
              const toolName = pluginId === 'unknown' ? tool.toolName.slice('plugin.'.length) : tool.toolName.slice(`plugin.${pluginId}.`.length)
              const pluginErrorCode = tool.result && typeof tool.result === 'object' && !Array.isArray(tool.result)
                ? (tool.result as { error?: { code?: unknown } }).error?.code : undefined
              writeAgentAudit({
                id: randomUUID(), timestamp: Date.now(), taskId: agentTaskId,
                workspaceId: agentWorkspaceId ?? 'unknown', actor: 'model', action: 'plugin.tool',
                outcome: tool.status === 'requested' ? 'ask' : tool.ok ? 'success' : 'failure',
                metadata: {
                  pluginId, version: activePluginVersions[pluginId], source: 'installed', toolName,
                  callId: tool.callId, model: preset.model,
                  errorCode: typeof pluginErrorCode === 'string' ? pluginErrorCode : undefined
                }
              })
            }
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
            if (tool.status === 'completed' && tool.ok === true && tool.toolName === 'workspace.patch' &&
                isPatchManifest(tool.result)) {
              appendPatchTimeline(
                timeline,
                agentTaskId,
                tool.result,
                getPatchWorkspaceService().previewContents(agentTaskId)
              )
            }
            if (tool.status === 'completed' && tool.ok === true && tool.toolName === 'browser.inspect' &&
                tool.result && typeof tool.result === 'object' && !Array.isArray(tool.result)) {
              const inspected = tool.result as { title?: unknown; url?: unknown; text?: unknown }
              if (typeof inspected.url === 'string' && typeof inspected.text === 'string') {
                timeline.blocks.push({
                  kind: 'toolContext', toolName: 'browser.inspect',
                  content: JSON.stringify({
                    title: typeof inspected.title === 'string' ? inspected.title.slice(0, 300) : '',
                    url: inspected.url.slice(0, 2_000),
                    text: inspected.text.slice(0, 16_000)
                  })
                })
              }
            }
            if (tool.status === 'completed' && tool.ok === true && tool.toolName === 'workspace.applyPatch' &&
                isPatchManifest(tool.result) && agentWorkspaceId && !wc.isDestroyed()) {
              wc.send(EVENTS.workspaceFilesChanged, {
                workspaceId: agentWorkspaceId,
                paths: tool.result.files.flatMap((file) => file.previousPath
                  ? [file.previousPath, file.path]
                  : [file.path])
              })
            }
            if (tool.status === 'completed' && tool.ok === true && tool.toolName === 'process.run' &&
                isCommandResult(tool.result) && isCommandInput(tool.args)) {
              appendCommandTimeline(timeline, tool.callId, tool.args, tool.result)
              if (agentWorkspaceId && !wc.isDestroyed()) {
                wc.send(EVENTS.workspaceFilesChanged, { workspaceId: agentWorkspaceId, paths: [] })
              }
            }
            if (tool.status === 'completed' && tool.ok === true && agentTaskId &&
                (tool.toolName === 'browser.screenshot' || tool.toolName === 'browser.screenshotCurrent' ||
                  tool.toolName === 'browser.screenshotElement')) {
              const artifact = consumeBrowserScreenshotArtifact(tool.result, agentTaskId, tool.callId)
              if (artifact) {
                const storedScreenshot = await getArtifactStore().putDataUrl(
                  `data:${artifact.mimeType};base64,${artifact.data}`, 'browser'
                )
                const attachment: Attachment = {
                  id: artifact.id,
                  kind: 'image',
                  name: tool.toolName === 'browser.screenshotElement'
                    ? 'browser-element-screenshot.jpg'
                    : 'browser-screenshot.jpg',
                  contentType: artifact.mimeType,
                  dataRef: storedScreenshot.ref,
                  meta: {
                    source: 'browser',
                    toolName: tool.toolName,
                    byteLength: artifact.byteLength,
                    hash: storedScreenshot.hash,
                    sizeBytes: storedScreenshot.sizeBytes
                  }
                }
                generatedAttachments.push(attachment)
                appendToolTimelineImage(
                  timeline,
                  attachment.id,
                  tool.toolName === 'browser.screenshotElement' ? '元素截图' : '网页截图'
                )
              }
            }
            await emit('streaming')
          },
          maxToolResultChars: Math.max(20_000, Math.min(400_000, Math.floor((preset.contextTokens ?? 128_000) * 1.4)))
        }) } finally { unsubscribeApprovals() }
        if (result.status === 'failed') {
          const failureMessage = result.error?.message ?? '任务执行失败'
          appendTaskReport(timeline, approvals, failureMessage)
          if (!content.trim()) {
            appendToolTimelineText(timeline, `本次执行未完成：${failureMessage}。请重试。`)
          }
          await emit('error', 'error')
          sendMessageNotice(wc, {
            id: randomUUID(), sessionId, level: 'error',
            message: failureMessage
          })
          return
        }
        appendTaskReport(timeline, approvals)
      } else if (activeSkills.length) {
        await runInteractiveChatLoop({
          model: runtime,
          messages: history,
          onEvent,
          requestUserInput: (args) => requestUserInput(wc, sessionId, args, signal)
        })
      } else if (useSearch) {
        if (preset.provider === 'kimi') await streamSearchChat(runtime, history, onEvent)
        else await streamDeepSeekSearch(runtime, history, onEvent)
      }
      else await streamChat(runtime, history, onEvent)
      if (useSearch) {
        const extracted = extractSourceCitations(content)
        const merged = new Map(sources.map((source) => [source.url, source]))
        for (const source of extracted) merged.set(source.url, source)
        sources = [...merged.values()].slice(0, 12)
      }
      await emit('done', 'completed')
      return
    } catch (e) {
      if (signal.aborted) {
        if (persistTimer) clearTimeout(persistTimer)
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
      await emit('error', 'error')
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
  if (toolName === 'workspace.discoverChecks') return '发现项目测试与构建脚本'
  if (toolName === 'workspace.patch') return `生成沙箱补丁：${clean(input.path) || '项目文件'}`
  if (toolName === 'workspace.applyPatch') return result ? '已验证并写回补丁' : '等待批准写回补丁'
  if (toolName.startsWith('git.')) return `查看 Git：${toolName.slice(4)}`
  if (toolName === 'browser.listTabs') return '读取当前浏览器标签页'
  if (toolName === 'browser.openTab') return result
    ? `网页已打开：${clean(input.url) || '目标网址'}`
    : `等待批准打开网页：${clean(input.url) || '目标网址'}`
  if (toolName === 'browser.waitForPage') return '等待已有页面完成加载'
  if (toolName === 'browser.inspect') return '检查当前网页内容'
  if (toolName === 'browser.find') return '定位网页元素'
  if (toolName === 'browser.screenshot' || toolName === 'browser.screenshotCurrent' ||
      toolName === 'browser.screenshotElement') return result
    ? '网页截图已保存到对话'
    : '截取网页画面'
  if (toolName.startsWith('browser.')) return `操作浏览器：${toolName.slice('browser.'.length)}`
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

function isPatchManifest(value: unknown): value is import('../services/agent/patchWorkspaceService').PatchManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.patchHash === 'string' && Array.isArray(candidate.files) &&
    typeof candidate.linesAdded === 'number' && typeof candidate.linesDeleted === 'number'
}

function isCommandInput(value: unknown): value is { executable: string; args: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.executable === 'string' && Array.isArray(candidate.args) &&
    candidate.args.every((arg) => typeof arg === 'string')
}

function isCommandResult(value: unknown): value is {
  exitCode: number | null; durationMs: number; truncated: boolean; stdout: string; stderr: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (candidate.exitCode === null || Number.isInteger(candidate.exitCode)) &&
    typeof candidate.durationMs === 'number' && typeof candidate.truncated === 'boolean' &&
    typeof candidate.stdout === 'string' && typeof candidate.stderr === 'string'
}

function approvalTarget(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '已批准操作'
  const input = value as Record<string, unknown>
  if (typeof input.path === 'string') return input.path.slice(0, 160)
  if (typeof input.url === 'string') return input.url.slice(0, 160)
  if (Array.isArray(input.paths)) return input.paths.filter((path) => typeof path === 'string').slice(0, 5).join(', ').slice(0, 160)
  if (typeof input.executable === 'string') {
    const args = Array.isArray(input.args) ? input.args.filter((arg) => typeof arg === 'string').slice(0, 5).join(' ') : ''
    return `${input.executable} ${args}`.trim().slice(0, 160)
  }
  return '已批准操作'
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

function isTerminalStatus(status: MessageStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled' || status === 'interrupted'
}

function cancellationFinishReason(reason: string): GenerationFinishReason {
  if (reason === 'user') return 'user_cancelled'
  if (reason === 'window_closed' || reason === 'session_deleted' || reason === 'workspace_switched' ||
      reason === 'app_quit' || reason === 'replaced') return reason
  return 'error'
}

async function failGenerationSetup(wc: WebContents, task: GenerationTask, message: string): Promise<void> {
  const snapshot = task.snapshot
  if (!snapshot || isTerminalStatus(snapshot.status)) return
  const terminal: Message = {
    ...snapshot,
    content: message,
    blocks: [{ kind: 'text', content: `本次执行未能启动：${message}。请检查配置后重试。` }],
    status: 'error',
    revision: (snapshot.revision ?? 0) + 1,
    finishReason: 'setup_error'
  }
  updateGenerationSnapshot(task, terminal)
  try {
    await getStore().upsertMessage(terminal)
    if (!wc.isDestroyed()) wc.send(EVENTS.messageStreamed, await materializeMessage(terminal))
  } catch (error) {
    console.warn('[message] terminal message persist failed:', error)
  }
}

function sendMessageNotice(wc: WebContents, notice: MessageNotice): void {
  if (!wc.isDestroyed()) wc.send(EVENTS.messageNotice, notice)
}

function scheduleMockReply(
  wc: WebContents,
  sessionId: string,
  task: ReturnType<typeof beginGeneration>,
  assistantId: string
): void {
  const steps = buildMockReply(sessionId, {
    id: assistantId,
    generationId: task.generationId,
    startRevision: task.snapshot?.revision,
    timestamp: task.snapshot?.timestamp
  })
  for (const [index, step] of steps.entries()) {
    addGenerationTimer(task, () => {
      if (wc.isDestroyed() || !isCurrentGeneration(sessionId, task)) return
      void getStore()
        .upsertMessage(step.message)
        .then(() => {
          updateGenerationSnapshot(task, step.message)
          wc.send(EVENTS.messageStreamed, step.message)
          if (index === steps.length - 1) finishGeneration(sessionId, task)
        })
        .catch(async (error) => {
          await failGenerationSetup(wc, task, '无法保存本次回答')
          finishGeneration(sessionId, task)
          console.warn('[mock] upsert failed:', error)
        })
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
