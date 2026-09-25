import type { Message, MessageBlock } from '../../shared/types'

/** Matches what MessageItem can actually render; empty/error placeholders are reusable. */
export function isVisibleMessage(message: Message): boolean {
  if (message.content.trim().length > 0 || (message.attachments?.length ?? 0) > 0) return true
  return message.blocks?.some(isVisibleBlock) ?? false
}

function isVisibleBlock(block: MessageBlock): boolean {
  if (block.kind === 'text' || block.kind === 'thinking') return block.content.trim().length > 0
  if (block.kind === 'plan') return block.items.length > 0
  if (block.kind === 'files') return block.files.length > 0
  if (block.kind === 'code') return block.code.trim().length > 0
  if (block.kind === 'sources') return block.sources.length > 0
  return false
}
