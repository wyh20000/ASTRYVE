import { randomUUID } from 'crypto'
import { ipcMain, type WebContents } from 'electron'
import { IPC, EVENTS } from '@shared/ipc'
import type { SendMessageInput, Message, MessageBlock, MessageStatus, ModelConfig } from '@shared/types'
import { getStore } from '../db'
import { buildMockReply } from '../services/mockAgent'
import { streamChat, type ChatMessage } from '../services/modelProvider'
import { getModelConfig, getActivePreset } from '../services/modelConfig'
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
      const user = await getStore().insertMessage({
        sessionId: input.sessionId,
        role: 'user',
        content: input.content
      })
      await autoTitle(input.sessionId, input.content)
      await getStore().touchSession(input.sessionId)
      // 触发回复（配置了模型则调用真实流式，否则回退 Mock）
      void runReply(event.sender, input.sessionId)
      return ok(user)
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })
}

async function runReply(wc: WebContents, sessionId: string): Promise<void> {
  const cfg = getModelConfig()
  const preset = getActivePreset()
  if (!preset || !preset.apiKey || !preset.baseUrl || !preset.model) {
    scheduleMockReply(wc, sessionId)
    return
  }
  await runModelReply(wc, preset, cfg.reasoningEffort, sessionId)
}

/** Agent 系统提示：写代码必须同步给出测试文件，便于代码审查 */
const AGENT_SYSTEM_PROMPT = [
  '你是一个专业的 AI 编程助手。',
  '重要要求：每次编写或修改代码时，必须同时提供对应的测试文件（pytest / vitest / jest 等），用于代码审查。',
  '请将代码与测试都放在 markdown 代码块中，并标注语言。'
].join('\n')

async function buildHistory(sessionId: string, contextMessages: number): Promise<ChatMessage[]> {
  const msgs = await getStore().listMessages(sessionId)
  const history: ChatMessage[] = msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .filter((m) => m.content.trim().length > 0)
    .slice(-(contextMessages || 20))
    .map((m) => ({ role: m.role as ChatMessage['role'], content: m.content }))
  return [{ role: 'system', content: AGENT_SYSTEM_PROMPT }, ...history]
}

async function runModelReply(
  wc: WebContents,
  preset: NonNullable<ReturnType<typeof getActivePreset>>,
  reasoningEffort: ModelConfig['reasoningEffort'],
  sessionId: string
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
    const history = await buildHistory(sessionId, preset.contextMessages)
    await streamChat(
      { baseUrl: preset.baseUrl, apiKey: preset.apiKey, model: preset.model, reasoningEffort },
      history,
      async (ev) => {
        if (ev.reasoning) reasoning += ev.reasoning
        if (ev.content) content += ev.content
        if (ev.done) return
        await emit('streaming')
      }
    )
    await emit('done')
  } catch (e) {
    const detail = (e as Error)?.message ?? '网络错误'
    content = content ? `${content}\n\n⚠️ 请求失败：${detail}` : `⚠️ 请求失败：${detail}`
    console.warn('[model] chat error:', detail) // 不打印 prompt / 响应内容
    await emit('done')
  }
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