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
  MessageNotice
} from '@shared/types'
import { getStore } from '../db'
import { buildMockReply } from '../services/mockAgent'
import {
  MODEL_RESOURCE_ERROR,
  isRetryableStreamError,
  streamChat,
  streamSearchChat,
  type ChatMessage,
  type StreamEvent
} from '../services/modelProvider'
import { getModelConfig, getActivePreset, normalizeContextMessages } from '../services/modelConfig'
import { extractDocumentText } from '../services/document'
import { toChatMessage, injectDocuments } from '../services/history'
import { ok, err } from './result'
import { supportsImageInput } from '@shared/modelCapabilities'

export function registerMessageIpc(): void {
  ipcMain.handle(IPC.message.list, async (_e, sessionId: string) => {
    try {
      return ok(await getStore().listMessages(sessionId))
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.message.send, async (event, input: SendMessageInput) => {
    try {
      const hasImages = (input.attachments ?? []).some((attachment) => attachment.kind === 'image')
      const activeModel = getActivePreset()?.model ?? ''
      if (hasImages && !supportsImageInput(activeModel)) {
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
      return err('DB_ERR', String(e))
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
  const cfg = getModelConfig()
  const preset = getActivePreset()
  if (!preset || !preset.apiKey || !preset.baseUrl || !preset.model) {
    scheduleMockReply(wc, sessionId)
    return
  }
  const vision = attachments.some((a) => a.kind === 'image')
  const useSearch = search && preset.provider === 'kimi' && !vision
  await runModelReply(wc, preset, cfg.reasoningEffort, sessionId, vision, docTexts, useSearch)
}

/** Agent 系统提示：通用助手，具备识图/文档/数据分析/文本处理能力 */
const AGENT_SYSTEM_PROMPT = [
  '你是一个专业的 AI 智能助手，具备识图、文档阅读、数据分析与通用文本处理能力。',
  '回答要求：',
  '- 使用简体中文，简洁、准确、结构清晰（适当使用 markdown 标题 / 列表 / 表格）。',
  '- 分析图片时描述其内容并回答相关问题；分析文档或表格时先理解数据再作答。',
  '- 需要给出代码时，将代码放在 markdown 代码块并标注语言。',
  '- 不编造事实；不确定时如实说明。'
].join('\n')

async function buildHistory(
  sessionId: string,
  contextMessages: number,
  vision: boolean
): Promise<ChatMessage[]> {
  const msgs = await getStore().listMessages(sessionId)
  const history: ChatMessage[] = msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .filter((m) => m.content.trim().length > 0 || (m.attachments ?? []).length > 0)
    .slice(-normalizeContextMessages(contextMessages))
    .map((m) => toChatMessage(m, vision))
  return [{ role: 'system', content: AGENT_SYSTEM_PROMPT }, ...history]
}

async function runModelReply(
  wc: WebContents,
  preset: NonNullable<ReturnType<typeof getActivePreset>>,
  reasoningEffort: ModelConfig['reasoningEffort'],
  sessionId: string,
  vision: boolean,
  docTexts: string[],
  search: boolean
): Promise<void> {
  const id = randomUUID()
  let reasoning = ''
  let content = ''

  const emit = async (status: MessageStatus): Promise<void> => {
    const blocks: MessageBlock[] = []
    if (reasoning) blocks.push({ kind: 'thinking', content: reasoning })
    if (content) blocks.push({ kind: 'text', content })
    const msg: Message = {
      id,
      sessionId,
      role: 'assistant',
      content,
      blocks: blocks.length ? blocks : undefined,
      status,
      timestamp: Date.now()
    }
    await getStore().upsertMessage(msg)
    if (!wc.isDestroyed()) wc.send(EVENTS.messageStreamed, msg)
  }

  await emit('streaming')
  const history = await buildHistory(sessionId, preset.contextMessages, vision)
  injectDocuments(history, docTexts)
  const runtime = {
    baseUrl: preset.baseUrl,
    apiKey: preset.apiKey,
    model: preset.model,
    reasoningEffort,
    vision
  }
  const onEvent = async (ev: StreamEvent): Promise<void> => {
    if (ev.reasoning) reasoning += ev.reasoning
    if (ev.content) content += ev.content
    if (ev.done) return
    await emit('streaming')
  }

  let retried = false
  while (true) {
    try {
      if (search) await streamSearchChat(runtime, history, onEvent)
      else await streamChat(runtime, history, onEvent)
      await emit('done')
      return
    } catch (e) {
      const retryable = isRetryableStreamError(e)
      // 尚未产生最终正文时允许重试一次；清空首轮思考，避免重试后重复展示。
      if (!search && retryable && !content && !retried) {
        retried = true
        reasoning = ''
        console.warn('[model] stream interrupted before content, retrying once')
        await emit('streaming')
        continue
      }

      const detail = (e as Error)?.message ?? '网络错误'
      console.warn('[model] chat error:', detail) // 不打印 prompt / 响应内容
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

function modelErrorMessage(detail: string, retryable: boolean, retried: boolean, hasContent: boolean): string {
  if (detail === MODEL_RESOURCE_ERROR) return '模型当前资源不足，请稍后再试'
  if (retryable && hasContent) return '模型连接中断，已保留生成内容；可发送“继续”继续分析'
  if (retryable && retried) return '模型连接中断，自动重试后仍未恢复，请稍后再试'
  if (retryable) return '模型连接中断，请稍后再试'
  return '模型请求失败，请检查模型配置或稍后再试'
}

function sendMessageNotice(wc: WebContents, notice: MessageNotice): void {
  if (!wc.isDestroyed()) wc.send(EVENTS.messageNotice, notice)
}

function scheduleMockReply(wc: WebContents, sessionId: string): void {
  const steps = buildMockReply(sessionId)
  for (const step of steps) {
    setTimeout(() => {
      if (wc.isDestroyed()) return
      void getStore()
        .upsertMessage(step.message)
        .then(() => wc.send(EVENTS.messageStreamed, step.message))
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
