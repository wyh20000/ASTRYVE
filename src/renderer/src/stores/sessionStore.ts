import { create } from 'zustand'
import type { Session } from '@shared/types'
import { useUiStore } from './uiStore'
import { useChatStore } from './chatStore'

const ACTIVE_SESSION_KEY = 'astryve:active-session-id'
const CLOSED_SESSION_VALUE = '__closed__'
function rememberActive(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id)
    else localStorage.removeItem(ACTIVE_SESSION_KEY)
  } catch { /* storage unavailable */ }
}
function rememberClosed(): void {
  try { localStorage.setItem(ACTIVE_SESSION_KEY, CLOSED_SESSION_VALUE) } catch { /* storage unavailable */ }
}

interface SessionState {
  sessions: Session[]
  activeId: string | null
  loading: boolean
  error: string | null
  init: () => Promise<void>
  create: (title?: string) => Promise<Session | null>
  createWork: (workspaceId: string, title?: string) => Promise<Session | null>
  select: (id: string) => void
  close: () => void
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
      let remembered: Session | undefined
      try {
        const rememberedId = localStorage.getItem(ACTIVE_SESSION_KEY)
        if (rememberedId === CLOSED_SESSION_VALUE) { set({ activeId: null }); return }
        remembered = res.data.find((session) => session.id === rememberedId)
      }
      catch { /* storage unavailable */ }
      if (remembered) { set({ activeId: remembered.id }); return }
      // 是否真正空白由主进程检查消息，标题为空并不等于没有历史。
      const top = res.data[0]
      const created = await window.agent.session.create({ title: '', kind: 'chat' })
      if (created.ok) {
        set((s) => ({ sessions: [created.data, ...s.sessions.filter((session) => session.id !== created.data.id)], activeId: created.data.id }))
        rememberActive(created.data.id)
      } else if (top) {
        set({ activeId: top.id })
        rememberActive(top.id)
      }
    } else {
      set({ loading: false, error: res.error.message })
    }
  },

  create: async (title) => {
    const res = await window.agent.session.create({ title, kind: 'chat' })
    if (!res.ok) { set({ error: res.error.message }); return null }
    set((s) => ({
      sessions: [res.data, ...s.sessions.filter((session) => session.id !== res.data.id)],
      activeId: res.data.id
    }))
    set({ error: null })
    rememberActive(res.data.id)
    return res.data
  },

  createWork: async (workspaceId, title) => {
    const res = await window.agent.session.create({ title, kind: 'work', workspaceId })
    if (!res.ok) {
      set({ error: res.error.message })
      return null
    }
    set((state) => ({ sessions: [res.data, ...state.sessions.filter((session) => session.id !== res.data.id)], activeId: res.data.id, error: null }))
    rememberActive(res.data.id)
    return res.data
  },

  select: (id) => { set({ activeId: id }); rememberActive(id) },
  close: () => { set({ activeId: null }); rememberClosed() },

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
      if (s.activeId === id) rememberActive(activeId)
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
