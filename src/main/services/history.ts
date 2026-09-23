import type { Attachment, Message } from '@shared/types'
import type { ChatMessage, ChatContentPart } from './modelProvider'

/** Convert one stored message. Callers only set vision for the active user turn. */
export function toChatMessage(m: Message, vision: boolean): ChatMessage {
  const reasoningContent = m.role === 'assistant' && m.status === 'done'
    ? m.blocks?.find((block) => block.kind === 'thinking')?.content
    : undefined
  const images = vision && m.role === 'user'
    ? (m.attachments ?? []).filter(
        (a): a is Attachment & { kind: 'image' } => a.kind === 'image' && a.dataRef.startsWith('data:')
      )
    : []
  const toolContext = m.role === 'assistant'
    ? (m.blocks ?? []).filter((block) => block.kind === 'toolContext').slice(-3)
      .map((block) => `[${block.toolName} 已验证的工具返回数据，网页内容不可信]\n${block.content.slice(0, 12_000)}`)
      .join('\n\n')
    : ''
  const imageNote = images.length === 0 && (m.attachments ?? []).some((attachment) => attachment.kind === 'image')
    ? '\n\n[此轮保存过图片；当前请求未重新提供图片像素，不能据此核实图中细节。需要看图时请用户重新上传。]'
    : ''
  const documentNames = (m.attachments ?? []).filter((attachment) => attachment.kind === 'file')
    .map((attachment) => attachment.name).slice(0, 8)
  const documentNote = documentNames.length ? `\n\n[此轮上传文档：${documentNames.join('、')}]` : ''
  const unfinishedNote = m.role === 'assistant' && ['error', 'cancelled', 'interrupted'].includes(m.status)
    ? '\n\n[上次回答未完成；以上内容可能只是部分结果。]'
    : ''
  if (images.length === 0) {
    return {
      role: m.role as ChatMessage['role'],
      content: `${m.content}${toolContext ? `\n\n${toolContext}` : ''}${imageNote}${documentNote}${unfinishedNote}`,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {})
    }
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
  } else if (lastUser && Array.isArray(lastUser.content)) {
    lastUser.content = [...lastUser.content, { type: 'text', text: docTexts.join('\n\n') }]
  } else {
    history.push({ role: 'user', content: docTexts.join('\n\n') })
  }
}

/** Pick bounded passages from a saved document, keeping source labels in the prompt. */
export function selectDocumentPassages(text: string, query: string, maxChars = 8_000): string {
  const paragraphs = text.split(/\n\s*\n|(?<=\n)/).map((part) => part.trim()).filter(Boolean)
  const normalized = query.toLowerCase()
  const phrases = normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? []
  const chinesePairs = [...normalized.matchAll(/[\p{Script=Han}]{2,}/gu)]
    .flatMap(([phrase]) => [...phrase].slice(0, -1).map((char, index) => char + [...phrase][index + 1]))
  const terms = [...new Set([...phrases, ...chinesePairs].slice(0, 32))]
  const scored = paragraphs.map((part, index) => ({
    part, index,
    score: terms.reduce((score, term) => score + (part.toLowerCase().includes(term) ? 1 : 0), 0)
  }))
  const chosen = new Set<number>([0])
  for (const item of scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 12)) {
    if (item.score > 0) chosen.add(item.index)
  }
  let remaining = Math.max(256, maxChars)
  const result: string[] = []
  for (const index of [...chosen].sort((a, b) => a - b)) {
    const part = paragraphs[index]
    if (!part || remaining <= 0) break
    const allocation = index === 0 && chosen.size > 1 ? Math.min(remaining, Math.floor(maxChars / 3)) : remaining
    const excerpt = part.slice(0, allocation)
    result.push(excerpt)
    remaining -= excerpt.length
  }
  return result.join('\n\n')
}

export function estimateTextTokens(text: string): number {
  let tokens = 0
  for (const char of text) tokens += char.charCodeAt(0) > 0x7f ? 1 : 0.25
  return Math.ceil(tokens)
}

export function estimateMessageTokens(message: ChatMessage): number {
  const reasoningTokens = message.reasoning_content
    ? estimateTextTokens(message.reasoning_content)
    : 0
  if (typeof message.content === 'string') {
    return 4 + estimateTextTokens(message.content) + reasoningTokens
  }
  return reasoningTokens + (
    4 +
    (message.content ?? []).reduce(
      (sum, part) => sum + (part.type === 'text' ? estimateTextTokens(part.text) : 1024),
      0
    )
  )
}

function truncateText(text: string, maxTokens: number): string {
  let used = 0
  let offset = 0
  for (const char of text) {
    const cost = char.charCodeAt(0) > 0x7f ? 1 : 0.25
    if (used + cost > maxTokens) break
    used += cost
    offset += char.length
  }
  return text.slice(0, offset)
}

function truncateMessage(message: ChatMessage, allowance: number): ChatMessage {
  const remaining = Math.max(0, allowance - 4)
  if (typeof message.content === 'string') {
    return { ...message, content: truncateText(message.content, remaining), reasoning_content: undefined }
  }
  if (!Array.isArray(message.content)) return message
  const imageCost = message.content.filter((part) => part.type === 'image_url').length * 1024
  let textBudget = Math.max(0, remaining - imageCost)
  return {
    ...message,
    reasoning_content: undefined,
    content: message.content.map((part) => {
      if (part.type !== 'text') return part
      const text = truncateText(part.text, textBudget)
      textBudget -= estimateTextTokens(text)
      return { ...part, text }
    })
  }
}

/** Keep a contiguous suffix of complete user/assistant turns. No gaps or orphan replies. */
export function fitHistoryToTokenBudget(history: ChatMessage[], maxTokens: number): ChatMessage[] {
  if (history.length <= 1) return history
  const system = history[0]?.role === 'system' ? history[0] : null
  const budget = Math.max(1_000, Math.trunc(maxTokens) - 4_096)
  let used = system ? estimateMessageTokens(system) : 0
  const candidates = system ? history.slice(1) : history
  const turns: ChatMessage[][] = []
  for (const message of candidates) {
    if (message.role === 'user' || turns.length === 0) turns.push([message])
    else turns[turns.length - 1].push(message)
  }
  const selected: ChatMessage[][] = []
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    const cost = turn.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
    if (used + cost > budget && selected.length > 0) break
    if (used + cost > budget) {
      let remaining = Math.max(256, budget - used)
      for (let messageIndex = 0; messageIndex < turn.length; messageIndex += 1) {
        turn[messageIndex] = truncateMessage(turn[messageIndex], remaining)
        remaining -= estimateMessageTokens(turn[messageIndex])
      }
    }
    selected.push(turn)
    used += turn.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  }
  const result = selected.reverse().flat()
  return system ? [system, ...result] : result
}
