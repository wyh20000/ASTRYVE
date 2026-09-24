import { create } from 'zustand'
import type { WorkspaceSummary } from '@shared/agent'
import { useSessionStore } from './sessionStore'

interface WorkspaceState {
  recent: WorkspaceSummary[]
  loading: boolean
  error: string | null
  load: () => Promise<void>
  selectAndActivate: (sessionId: string) => Promise<void>
  selectAndCreateWork: () => Promise<void>
  activate: (sessionId: string, workspaceId: string) => Promise<void>
  revoke: (workspaceId: string) => Promise<boolean>
}

function sortRecent(workspaces: WorkspaceSummary[]): WorkspaceSummary[] {
  return [...workspaces].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  recent: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true })
    const result = await window.agent.workspace.listRecent()
    if (result.ok) set({ recent: sortRecent(result.data), loading: false, error: null })
    else set({ loading: false, error: result.error.message })
  },

  selectAndActivate: async (sessionId) => {
    set({ loading: true, error: null })
    const selected = await window.agent.workspace.select()
    if (!selected.ok) {
      set({ loading: false, error: selected.error.message })
      return
    }
    if (!selected.data) {
      set({ loading: false })
      return
    }
    set({ recent: sortRecent([selected.data, ...get().recent.filter((w) => w.id !== selected.data?.id)]) })
    await get().activate(sessionId, selected.data.id)
  },

  selectAndCreateWork: async () => {
    set({ loading: true, error: null })
    const selected = await window.agent.workspace.select()
    if (!selected.ok) { set({ loading: false, error: selected.error.message }); return }
    if (!selected.data) { set({ loading: false }); return }
    set((state) => ({ recent: sortRecent([selected.data!, ...state.recent.filter((item) => item.id !== selected.data!.id)]) }))
    const session = await useSessionStore.getState().createWork(selected.data.id)
    set({ loading: false, error: session ? null : '工作会话创建失败' })
  },

  activate: async (sessionId, workspaceId) => {
    set({ loading: true, error: null })
    const result = await window.agent.workspace.activate({ sessionId, workspaceId })
    if (!result.ok) {
      set({ loading: false, error: result.error.message })
      return
    }
    useSessionStore.getState().update(result.data.session)
    set((state) => ({
      recent: sortRecent([
        result.data.workspace,
        ...state.recent.filter((workspace) => workspace.id !== result.data.workspace.id)
      ]),
      loading: false,
      error: null
    }))
  },
  revoke: async (workspaceId) => {
    const result = await window.agent.workspace.revoke(workspaceId)
    if (!result.ok) { set({ error: result.error.message }); return false }
    set((state) => ({ recent: state.recent.filter((workspace) => workspace.id !== workspaceId), error: null }))
    return true
  }
}))
