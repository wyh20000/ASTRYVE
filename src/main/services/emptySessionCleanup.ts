import type { DbStore } from '../db'
import type { Message, MessageBlock } from '../../shared/types'

type SessionCleanupStore = Pick<DbStore, 'listSessions' | 'listMessages' | 'deleteSession'>

/** Removes only sessions that contain no messages. Called during graceful shutdown. */
export async function cleanupEmptySessions(store: SessionCleanupStore): Promise<number> {
  const sessions = await store.listSessions()
  let removed = 0
  for (const session of sessions.slice(0, 10_000)) {
    try {
      const messages = await store.listMessages(session.id)
      if (messages.some(isVisibleMessage)) continue
      await store.deleteSession(session.id)
      removed += 1
    } catch (error) {
      console.warn('[session] failed to inspect empty session:', session.id, error)
    }
  }
  return removed
}

/** Matches what MessageItem can actually render; empty/error placeholders do not keep a session alive. */
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
