import { create } from 'zustand'
import type { Message } from '@shared/types'
import { useSessionStore } from './sessionStore'

interface ChatState {
  /** sessionId -> messages（按 timestamp 升序） */
  messages: Record<string, Message[]>
  sending: Record<string, boolean>
  /** 加载某个会话的消息 */
  load: (sessionId: string) => Promise<void>
  /** 发送用户消息（本地 Mock 回复已由主进程推送，经 upsertMessage 合并） */
  send: (sessionId: string, content: string) => Promise<void>
  /** 从主进程流式事件合并一条消息 */
  upsertMessage: (msg: Message) => void
  clear: () => void
}

function append(record: Record<string, Message[]>, sessionId: string, msg: Message): Record<string, Message[]> {
  const list = record[sessionId] ?? []
  const idx = list.findIndex((m) => m.id === msg.id)
  let next: Message[]
  if (idx >= 0) {
    next = list.slice()
    next[idx] = msg
  } else {
    next = [...list, msg]
  }
  next.sort((a, b) => a.timestamp - b.timestamp)
  return { ...record, [sessionId]: next }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  sending: {},

  load: async (sessionId) => {
    const res = await window.agent.message.list(sessionId)
    if (res.ok) {
      set((s) => ({ messages: { ...s.messages, [sessionId]: res.data } }))
    }
  },

  send: async (sessionId, content) => {
    const res = await window.agent.message.send({ sessionId, content })
    if (!res.ok) return
    set((s) => ({
      messages: append(s.messages, sessionId, res.data),
      sending: { ...s.sending, [sessionId]: true }
    }))
    // 主进程可能已自动生成会话标题，刷新一次以同步侧栏
    void useSessionStore.getState().touch(sessionId)
  },

  upsertMessage: (msg) => {
    set((s) => {
      const sending = { ...s.sending }
      if (msg.status === 'done') sending[msg.sessionId] = false
      return { messages: append(s.messages, msg.sessionId, msg), sending }
    })
  },

  clear: () => set({ messages: {}, sending: {} })
}))
