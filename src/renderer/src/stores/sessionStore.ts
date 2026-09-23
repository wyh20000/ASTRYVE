import { create } from 'zustand'
import type { Session } from '@shared/types'
import { useUiStore } from './uiStore'
import { useChatStore } from './chatStore'

interface SessionState {
  sessions: Session[]
  activeId: string | null
  loading: boolean
  error: string | null
  init: () => Promise<void>
  create: (title?: string) => Promise<Session | null>
  select: (id: string) => void
  rename: (id: string, title: string) => Promise<void>
  remove: (id: string) => Promise<void>
  touch: (id: string) => Promise<void>
  update: (session: Session) => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeId: null,
  loading: false,
  error: null,

  init: async () => {
    if (get().loading) return
    set({ loading: true })
    const res = await window.agent.session.list()
    if (res.ok) {
      set({ sessions: res.data, loading: false, error: null })
      // 默认展示一个新对话：若最近会话已是空的新对话则复用，否则新建
      const top = res.data[0]
      const reusable = res.data.find((session) => !session.title.trim())
      if (reusable) {
        set({ activeId: reusable.id })
      } else {
        const created = await window.agent.session.create({ title: '' })
        if (created.ok) {
          set((s) => ({ sessions: [created.data, ...s.sessions], activeId: created.data.id }))
        } else if (top) {
          set({ activeId: top.id })
        }
      }
    } else {
      set({ loading: false, error: res.error.message })
    }
  },

  create: async (title) => {
    if (!title?.trim()) {
      const reusable = get().sessions.find((session) => !session.title.trim())
      if (reusable) {
        set({ activeId: reusable.id })
        return reusable
      }
    }
    const res = await window.agent.session.create({ title })
    if (!res.ok) return null
    set((s) => ({
      sessions: [res.data, ...s.sessions.filter((session) => session.id !== res.data.id)],
      activeId: res.data.id
    }))
    return res.data
  },

  select: (id) => set({ activeId: id }),

  rename: async (id, title) => {
    const res = await window.agent.session.rename(id, title)
    if (!res.ok) return
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? res.data : x))
    }))
  },

  remove: async (id) => {
    const res = await window.agent.session.remove(id)
    if (!res.ok) return
    useUiStore.getState().clearDraft(id)
    useChatStore.getState().forgetSession(id)
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id)
      const activeId = s.activeId === id ? (sessions[0]?.id ?? null) : s.activeId
      return { sessions, activeId }
    })
  },

  touch: async (id) => {
    const res = await window.agent.session.touch(id)
    if (!res.ok) return
    set((s) => ({
      sessions: s.sessions
        .map((x) => (x.id === id ? res.data : x))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    }))
  },

  update: (session) =>
    set((state) => ({
      sessions: state.sessions
        .map((item) => (item.id === session.id ? session : item))
        .sort((left, right) => right.updatedAt - left.updatedAt)
    }))
}))
