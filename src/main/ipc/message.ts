import { randomUUID } from 'crypto'
import { ipcMain, type WebContents } from 'electron'
import { IPC, EVENTS } from '@shared/ipc'
import type { SendMessageInput, Message, MessageBlock, Attachment, MessageStatus, ModelConfig } from '@shared/types'
import { getStore } from '../db'
import { buildMockReply } from '../services/mockAgent'
import { streamChat, streamSearchChat, type ChatMessage, type StreamEvent } from '../services/modelProvider'
import { getModelConfig, getActivePreset } from '../services/modelConfig'
import { extractDocumentText } from '../services/document'
import { toChatMessage, injectDocuments } from '../services/history'
import { ok, err } from './result'

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
  if (vision && !preset.supportsVision) {
    await emitVisionUnsupported(wc, sessionId)
    return
  }
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
    .slice(-(contextMessages || 20))
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

  try {
    await emit('streaming')
    const history = await buildHistory(sessionId, preset.contextMessages, vision)
    injectDocuments(history, docTexts)
    const runtime = {
      baseUrl: preset.baseUrl,
      apiKey: preset.apiKey,
      model: vision ? (preset.visionModel ?? preset.model) : preset.model,
      reasoningEffort,
      vision
    }
    const onEvent = async (ev: StreamEvent): Promise<void> => {
      if (ev.reasoning) reasoning += ev.reasoning
      if (ev.content) content += ev.content
      if (ev.done) return
      await emit('streaming')
    }
    if (search) await streamSearchChat(runtime, history, onEvent)
    else await streamChat(runtime, history, onEvent)
    await emit('done')
  } catch (e) {
    const detail = (e as Error)?.message ?? '网络错误'
    content = content ? `${content}\n\n⚠️ 请求失败：${detail}` : `⚠️ 请求失败：${detail}`
    console.warn('[model] chat error:', detail) // 不打印 prompt / 响应内容
    await emit('done')
  }
}

/** 当前模型不支持图片时，插入一条明确的提示消息 */
async function emitVisionUnsupported(wc: WebContents, sessionId: string): Promise<void> {
  const msg: Message = {
    id: randomUUID(),
    sessionId,
    role: 'assistant',
    content: '当前模型不支持图片输入。请在「设置 → 模型设置」中切换到支持视觉的模型（如 Kimi 视觉）。',
    status: 'done',
    timestamp: Date.now()
  }
  await getStore().upsertMessage(msg)
  if (!wc.isDestroyed()) wc.send(EVENTS.messageStreamed, msg)
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