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
