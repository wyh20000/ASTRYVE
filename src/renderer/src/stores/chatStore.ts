import { create } from 'zustand'
import type { Message, MessageCursor, Attachment, IpcResult, MessageNotice, UserInputRequest, ApprovalUiRequest } from '@shared/types'
import { useSessionStore } from './sessionStore'

interface ChatState {
  /** sessionId -> messages（按 timestamp 升序） */
  messages: Record<string, Message[]>
  sending: Record<string, boolean>
  activeGenerations: Record<string, string | undefined>
  hasOlder: Record<string, boolean>
  loadingOlder: Record<string, boolean>
  loadErrors: Record<string, string | undefined>
  removedSessions: Record<string, true>
  notices: Record<string, MessageNotice | undefined>
  inputRequests: Record<string, UserInputRequest | undefined>
  approvalRequests: Record<string, ApprovalUiRequest | undefined>
  /** 加载某个会话的消息 */
  load: (sessionId: string) => Promise<void>
  loadOlder: (sessionId: string) => Promise<void>
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
  forgetSession: (sessionId: string) => void
}

function isNewerOrEqual(current: Message | undefined, incoming: Message): boolean {
  if (!current) return true
  if (current.generationId && incoming.generationId && current.generationId !== incoming.generationId) {
    return false
  }
  return (incoming.revision ?? 0) >= (current.revision ?? 0)
}

function append(record: Record<string, Message[]>, sessionId: string, msg: Message): Record<string, Message[]> {
  const list = record[sessionId] ?? []
  const idx = list.findIndex((m) => m.id === msg.id)
  let next: Message[]
  if (idx >= 0) {
    if (!isNewerOrEqual(list[idx], msg)) return record
    next = list.slice()
    next[idx] = msg
  } else {
    next = [...list, msg]
  }
  next.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
  return { ...record, [sessionId]: next }
}

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  let record: Record<string, Message[]> = { current }
  for (const message of incoming) record = append(record, 'current', message)
  return record.current
}

const TERMINAL_STATUSES = new Set<Message['status']>(['done', 'error', 'cancelled', 'interrupted'])

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  sending: {},
  activeGenerations: {},
  hasOlder: {},
  loadingOlder: {},
  loadErrors: {},
  removedSessions: {},
  notices: {},
  inputRequests: {},
  approvalRequests: {},

  load: async (sessionId) => {
    if (get().removedSessions[sessionId]) return
    try {
      const res = await window.agent.message.list(sessionId)
      if (!res.ok) throw new Error(res.error.message)
      set((s) => s.removedSessions[sessionId] ? s : ({
        messages: { ...s.messages, [sessionId]: mergeMessages(s.messages[sessionId] ?? [], res.data) },
        hasOlder: { ...s.hasOlder, [sessionId]: res.data.length >= 100 },
        loadErrors: { ...s.loadErrors, [sessionId]: undefined }
      }))
    } catch (error) {
      set((s) => s.removedSessions[sessionId] ? s : ({
        loadErrors: { ...s.loadErrors, [sessionId]: error instanceof Error ? error.message : '历史记录读取失败' }
      }))
    }
  },

  loadOlder: async (sessionId) => {
    const state = get()
    if (state.loadingOlder[sessionId] || !state.hasOlder[sessionId]) return
    const first = state.messages[sessionId]?.[0]
    if (!first) return
    const before: MessageCursor = { timestamp: first.timestamp, id: first.id }
    set((current) => ({ loadingOlder: { ...current.loadingOlder, [sessionId]: true } }))
    try {
      const result = await window.agent.message.list(sessionId, before)
      if (!result.ok) throw new Error(result.error.message)
      set((current) => current.removedSessions[sessionId] ? current : ({
        messages: { ...current.messages, [sessionId]: mergeMessages(current.messages[sessionId] ?? [], result.data) },
        hasOlder: { ...current.hasOlder, [sessionId]: result.data.length >= 100 }
      }))
    } finally {
      set((current) => current.removedSessions[sessionId] ? current : ({
        loadingOlder: { ...current.loadingOlder, [sessionId]: false }
      }))
    }
  },

  send: async (sessionId, content, attachments, search, skillIds, pluginIds) => {
    if (get().removedSessions[sessionId]) {
      return { ok: false, error: { code: 'SESSION_REMOVED', message: '会话已删除，请新建对话' } }
    }
    if (get().activeGenerations[sessionId]) {
      return { ok: false, error: { code: 'ALREADY_SENDING', message: '当前回答仍在生成，请先停止或等待完成' } }
    }
    const clientMessageId = crypto.randomUUID()
    set((s) => ({
      sending: { ...s.sending, [sessionId]: true },
      activeGenerations: { ...s.activeGenerations, [sessionId]: clientMessageId }
    }))
    let res: IpcResult<Message>
    try {
      res = await window.agent.message.send({ clientMessageId, sessionId, content, attachments, search, skillIds, pluginIds })
    } catch {
      res = { ok: false, error: { code: 'SEND_UNAVAILABLE', message: '发送失败，请重试' } }
    }
    if (!res.ok) {
      set((s) => !s.removedSessions[sessionId] && s.activeGenerations[sessionId] === clientMessageId ? {
        sending: { ...s.sending, [sessionId]: false },
        activeGenerations: { ...s.activeGenerations, [sessionId]: undefined }
      } : s)
      return res
    }
    set((s) => s.removedSessions[sessionId] ? s : ({ messages: append(s.messages, sessionId, res.data) }))
    // 主进程可能已自动生成会话标题，刷新一次以同步侧栏
    if (!get().removedSessions[sessionId]) void useSessionStore.getState().touch(sessionId)
    return res
  },

  stop: async (sessionId) => {
    const result = await window.agent.message.stop(sessionId)
    if (result.ok && !result.data.stopped) {
      set((s) => s.removedSessions[sessionId] ? s : ({
        sending: { ...s.sending, [sessionId]: false },
        activeGenerations: { ...s.activeGenerations, [sessionId]: undefined }
      }))
    }
  },

  upsertMessage: (msg) => {
    set((s) => {
      if (s.removedSessions[msg.sessionId]) return s
      const sending = { ...s.sending }
      const activeGenerations = { ...s.activeGenerations }
      if (TERMINAL_STATUSES.has(msg.status) && msg.generationId &&
          activeGenerations[msg.sessionId] === msg.generationId) {
        sending[msg.sessionId] = false
        activeGenerations[msg.sessionId] = undefined
      }
      return { messages: append(s.messages, msg.sessionId, msg), sending, activeGenerations }
    })
  },

  setNotice: (notice) => {
    set((s) => s.removedSessions[notice.sessionId] ? s : ({ notices: { ...s.notices, [notice.sessionId]: notice } }))
  },

  clearNotice: (sessionId, noticeId) => {
    set((s) => {
      const current = s.notices[sessionId]
      if (!current || (noticeId && current.id !== noticeId)) return s
      return { notices: { ...s.notices, [sessionId]: undefined } }
    })
  },

  setInputRequest: (request) => set((s) => s.removedSessions[request.sessionId] ? s : ({
    inputRequests: { ...s.inputRequests, [request.sessionId]: request }
  })),

  clearInputRequest: (sessionId, requestId) => set((s) => {
    const current = s.inputRequests[sessionId]
    if (!current || (requestId && current.id !== requestId)) return s
    return { inputRequests: { ...s.inputRequests, [sessionId]: undefined } }
  }),

  setApprovalRequest: (request) => set((s) => s.removedSessions[request.sessionId] ? s : ({
    approvalRequests: { ...s.approvalRequests, [request.sessionId]: request }
  })),

  clearApprovalRequest: (sessionId, requestId) => set((s) => {
    const current = s.approvalRequests[sessionId]
    if (!current || (requestId && current.id !== requestId)) return s
    return { approvalRequests: { ...s.approvalRequests, [sessionId]: undefined } }
  }),

  forgetSession: (sessionId) => set((state) => {
    const omit = <T>(source: Record<string, T>): Record<string, T> => {
      const next = { ...source }
      delete next[sessionId]
      return next
    }
    return {
      messages: omit(state.messages), sending: omit(state.sending),
      activeGenerations: omit(state.activeGenerations), hasOlder: omit(state.hasOlder),
      loadingOlder: omit(state.loadingOlder), loadErrors: omit(state.loadErrors),
      notices: omit(state.notices), inputRequests: omit(state.inputRequests),
      approvalRequests: omit(state.approvalRequests),
      removedSessions: { ...state.removedSessions, [sessionId]: true }
    }
  }),

  clear: () => set({ messages: {}, sending: {}, activeGenerations: {}, hasOlder: {}, loadingOlder: {},
    loadErrors: {}, removedSessions: {}, notices: {}, inputRequests: {}, approvalRequests: {} })
}))
