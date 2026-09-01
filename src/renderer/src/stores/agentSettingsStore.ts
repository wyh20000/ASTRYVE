import { create } from 'zustand'
import type {
  AgentProjectPreferences,
  AgentProjectSettings
} from '@shared/types'
import type { ExecutionEnvironment, PermissionMode } from '@shared/agent'

interface AgentSettingsState {
  projects: Record<string, AgentProjectSettings>
  loading: Record<string, boolean>
  errors: Record<string, string | undefined>
  load: (workspaceId: string) => Promise<void>
  setPermissionMode: (workspaceId: string, permissionMode: PermissionMode) => Promise<void>
  setExecutionEnvironment: (
    workspaceId: string,
    executionEnvironment: ExecutionEnvironment
  ) => Promise<void>
}

export const useAgentSettingsStore = create<AgentSettingsState>((set, get) => ({
  projects: {},
  loading: {},
  errors: {},

  load: async (workspaceId) => {
    set((state) => ({
      loading: { ...state.loading, [workspaceId]: true },
      errors: { ...state.errors, [workspaceId]: undefined }
    }))
    const result = await window.agent.settings.getAgentProject(workspaceId)
    if (result.ok) {
      set((state) => ({
        projects: { ...state.projects, [workspaceId]: result.data },
        loading: { ...state.loading, [workspaceId]: false }
      }))
    } else {
      set((state) => ({
        loading: { ...state.loading, [workspaceId]: false },
        errors: { ...state.errors, [workspaceId]: result.error.message }
      }))
    }
  },

  setPermissionMode: async (workspaceId, permissionMode) => {
    const current = get().projects[workspaceId]
    if (!current) return
    await save({ ...current.preferences, permissionMode }, set)
  },

  setExecutionEnvironment: async (workspaceId, executionEnvironment) => {
    const current = get().projects[workspaceId]
    if (!current) return
    await save({ ...current.preferences, executionEnvironment }, set)
  }
}))

async function save(
  preferences: AgentProjectPreferences,
  set: Parameters<typeof useAgentSettingsStore.setState>[0] extends never
    ? never
    : typeof useAgentSettingsStore.setState
): Promise<void> {
  const workspaceId = preferences.workspaceId
  set((state) => ({
    loading: { ...state.loading, [workspaceId]: true },
    errors: { ...state.errors, [workspaceId]: undefined }
  }))
  const result = await window.agent.settings.setAgentProject(preferences)
  if (result.ok) {
    set((state) => ({
      projects: { ...state.projects, [workspaceId]: result.data },
      loading: { ...state.loading, [workspaceId]: false }
    }))
  } else {
    set((state) => ({
      loading: { ...state.loading, [workspaceId]: false },
      errors: { ...state.errors, [workspaceId]: result.error.message }
    }))
  }
}
