import type { Attachment, Message } from '@shared/types'
import type { ChatMessage, ChatContentPart } from './modelProvider'

/**
 * 将持久化消息转为模型消息。
 * 仅当当前请求为视觉请求（vision=true）时，才把历史图片转为 image_url；
 * 纯文本请求会剥掉历史图片只留文字，避免不支持图片的模型收到 image_url 而报 400。
 */
export function toChatMessage(m: Message, vision: boolean): ChatMessage {
  const images = vision
    ? (m.attachments ?? []).filter(
        (a): a is Attachment & { kind: 'image' } => a.kind === 'image' && a.dataRef.startsWith('data:')
      )
    : []
  if (images.length === 0) {
    return { role: m.role as ChatMessage['role'], content: m.content }
  }
  const parts: ChatContentPart[] = []
  if (m.content.trim()) parts.push({ type: 'text', text: m.content })
  for (const img of images) parts.push({ type: 'image_url', image_url: { url: img.dataRef } })
  return { role: 'user', content: parts }
}

/** 将文档文本注入到最后一条用户消息（或追加一条 user 消息） */
export function injectDocuments(history: ChatMessage[], docTexts: string[]): void {
  if (docTexts.length === 0) return
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  if (lastUser && typeof lastUser.content === 'string') {
    lastUser.content = `${lastUser.content}\n\n${docTexts.join('\n\n')}`
  } else {
    history.push({ role: 'user', content: docTexts.join('\n\n') })
  }
}

export function estimateTextTokens(text: string): number {
  let tokens = 0
  for (const char of text) tokens += char.charCodeAt(0) > 0x7f ? 1 : 0.25
  return Math.ceil(tokens)
}

export function estimateMessageTokens(message: ChatMessage): number {
  if (typeof message.content === 'string') return 4 + estimateTextTokens(message.content)
  return (
    4 +
    (message.content ?? []).reduce(
      (sum, part) => sum + (part.type === 'text' ? estimateTextTokens(part.text) : 1024),
      0
    )
  )
}

/** 保留系统提示和最新消息，按近似 token 预算从新到旧装入上下文。 */
export function fitHistoryToTokenBudget(history: ChatMessage[], maxTokens: number): ChatMessage[] {
  if (history.length <= 1) return history
  const system = history[0]?.role === 'system' ? history[0] : null
  const budget = Math.max(1_000, Math.trunc(maxTokens) - 4_096)
  let used = system ? estimateMessageTokens(system) : 0
  const selected: ChatMessage[] = []
  const candidates = system ? history.slice(1) : history
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index]
    const cost = estimateMessageTokens(message)
    if (used + cost > budget && selected.length > 0) continue
    if (used + cost > budget && typeof message.content === 'string') {
      const remaining = Math.max(256, budget - used)
      message.content = message.content.slice(0, remaining * 2)
    }
    selected.push(message)
    used += Math.min(cost, budget - used)
    if (used >= budget) break
  }
  selected.reverse()
  return system ? [system, ...selected] : selected
}
