import { create } from 'zustand'
import type { Message, Attachment, IpcResult, MessageNotice, UserInputRequest, ApprovalUiRequest } from '@shared/types'
import { useSessionStore } from './sessionStore'

interface ChatState {
  /** sessionId -> messages（按 timestamp 升序） */
  messages: Record<string, Message[]>
  sending: Record<string, boolean>
  notices: Record<string, MessageNotice | undefined>
  inputRequests: Record<string, UserInputRequest | undefined>
  approvalRequests: Record<string, ApprovalUiRequest | undefined>
  /** 加载某个会话的消息 */
  load: (sessionId: string) => Promise<void>
  /** 发送用户消息（本地 Mock 回复已由主进程推送，经 upsertMessage 合并） */
  send: (
    sessionId: string,
    content: string,
    attachments?: Attachment[],
    search?: boolean,
    skillIds?: string[],
    pluginIds?: string[]
  ) => Promise<IpcResult<Message>>
  stop: (sessionId: string) => Promise<void>
  /** 从主进程流式事件合并一条消息 */
  upsertMessage: (msg: Message) => void
  setNotice: (notice: MessageNotice) => void
  clearNotice: (sessionId: string, noticeId?: string) => void
  setInputRequest: (request: UserInputRequest) => void
  clearInputRequest: (sessionId: string, requestId?: string) => void
  setApprovalRequest: (request: ApprovalUiRequest) => void
  clearApprovalRequest: (sessionId: string, requestId?: string) => void
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
  notices: {},
  inputRequests: {},
  approvalRequests: {},

  load: async (sessionId) => {
    const res = await window.agent.message.list(sessionId)
    if (res.ok) {
      set((s) => ({ messages: { ...s.messages, [sessionId]: res.data } }))
    }
  },

  send: async (sessionId, content, attachments, search, skillIds, pluginIds) => {
    const res = await window.agent.message.send({ sessionId, content, attachments, search, skillIds, pluginIds })
    if (!res.ok) return res
    set((s) => ({
      messages: append(s.messages, sessionId, res.data),
      sending: { ...s.sending, [sessionId]: true }
    }))
    // 主进程可能已自动生成会话标题，刷新一次以同步侧栏
    void useSessionStore.getState().touch(sessionId)
    return res
  },

  stop: async (sessionId) => {
    await window.agent.message.stop(sessionId)
    set((s) => ({ sending: { ...s.sending, [sessionId]: false } }))
  },

  upsertMessage: (msg) => {
    set((s) => {
      const sending = { ...s.sending }
      if (msg.status === 'done' || msg.status === 'error') sending[msg.sessionId] = false
      return { messages: append(s.messages, msg.sessionId, msg), sending }
    })
  },

  setNotice: (notice) => {
    set((s) => ({ notices: { ...s.notices, [notice.sessionId]: notice } }))
  },

  clearNotice: (sessionId, noticeId) => {
    set((s) => {
      const current = s.notices[sessionId]
      if (!current || (noticeId && current.id !== noticeId)) return s
      return { notices: { ...s.notices, [sessionId]: undefined } }
    })
  },

  setInputRequest: (request) => set((s) => ({
    inputRequests: { ...s.inputRequests, [request.sessionId]: request }
  })),

  clearInputRequest: (sessionId, requestId) => set((s) => {
    const current = s.inputRequests[sessionId]
    if (!current || (requestId && current.id !== requestId)) return s
    return { inputRequests: { ...s.inputRequests, [sessionId]: undefined } }
  }),

  setApprovalRequest: (request) => set((s) => ({
    approvalRequests: { ...s.approvalRequests, [request.sessionId]: request }
  })),

  clearApprovalRequest: (sessionId, requestId) => set((s) => {
    const current = s.approvalRequests[sessionId]
    if (!current || (requestId && current.id !== requestId)) return s
    return { approvalRequests: { ...s.approvalRequests, [sessionId]: undefined } }
  }),

  clear: () => set({ messages: {}, sending: {}, notices: {}, inputRequests: {}, approvalRequests: {} })
}))
