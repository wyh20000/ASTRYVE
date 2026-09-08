import { create } from 'zustand'
import type { SkillCatalogItem, SkillMetadata } from '@shared/types'

interface SkillState {
  items: SkillMetadata[]
  catalog: SkillCatalogItem[]
  loading: boolean
  mutating: boolean
  error?: string
  workspaceId?: string
  load: (workspaceId?: string) => Promise<void>
  loadCatalog: (query?: string) => Promise<void>
  install: (url: string) => Promise<boolean>
  importLocal: () => Promise<boolean>
  uninstall: (id: string) => Promise<boolean>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
}

export const useSkillStore = create<SkillState>((set, get) => ({
  items: [], catalog: [], loading: false, mutating: false,
  load: async (workspaceId) => {
    set({ loading: true, error: undefined, workspaceId })
    const result = await window.agent.skills.list({ workspaceId })
    if (result.ok) set({ items: result.data, loading: false })
    else set({ error: result.error.message, loading: false })
  },
  loadCatalog: async (query) => {
    set({ loading: true, error: undefined })
    const result = await window.agent.skills.catalog({ query })
    if (result.ok) set({ catalog: result.data, loading: false })
    else set({ error: result.error.message, loading: false })
  },
  install: async (url) => {
    set({ mutating: true, error: undefined })
    const result = await window.agent.skills.install({ url, workspaceId: get().workspaceId })
    if (result.ok) { set({ items: result.data, mutating: false }); await get().loadCatalog(); return true }
    set({ error: result.error.message, mutating: false }); return false
  },
  importLocal: async () => {
    set({ mutating: true, error: undefined })
    const result = await window.agent.skills.importLocal({ workspaceId: get().workspaceId })
    if (result.ok) { set({ items: result.data, mutating: false }); return true }
    set({ error: result.error.message, mutating: false }); return false
  },
  uninstall: async (id) => {
    set({ mutating: true, error: undefined })
    const result = await window.agent.skills.uninstall({ id, workspaceId: get().workspaceId })
    if (result.ok) { set({ items: result.data, mutating: false }); await get().loadCatalog(); return true }
    set({ error: result.error.message, mutating: false }); return false
  },
  setEnabled: async (id, enabled) => {
    const result = await window.agent.skills.setEnabled({ id, enabled, workspaceId: get().workspaceId })
    if (result.ok) set({ items: result.data, error: undefined })
    else set({ error: result.error.message })
  }
}))
