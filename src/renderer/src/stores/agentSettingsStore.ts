import { create } from 'zustand'
import type { AgentProjectSettings } from '@shared/types'
import type { ExecutionEnvironment, PermissionMode } from '@shared/agent'

interface AgentSettingsState {
  projects: Record<string, AgentProjectSettings>
  loading: Record<string, boolean>
  errors: Record<string, string | undefined>
  load: (workspaceId: string) => Promise<void>
  setPermissionMode: (workspaceId: string, mode: PermissionMode) => Promise<void>
  setExecutionEnvironment: (workspaceId: string, environment: ExecutionEnvironment) => Promise<void>
  setDockerImage: (workspaceId: string, dockerImageId: string) => Promise<void>
}

export const useAgentSettingsStore = create<AgentSettingsState>((set, get) => {
  // Serialize requests per project so stale reads cannot replace newly saved settings.
  async function request(
    workspaceId: string,
    operation: () => ReturnType<typeof window.agent.settings.getAgentProject>
  ): Promise<void> {
    if (get().loading[workspaceId]) return
    set((state) => ({
      loading: { ...state.loading, [workspaceId]: true },
      errors: { ...state.errors, [workspaceId]: undefined }
    }))
    try {
      const result = await operation()
      if (!result.ok) throw new Error(result.error.message)
      if (result.data.preferences.workspaceId !== workspaceId) throw new Error('项目设置响应不匹配')
      set((state) => ({ projects: { ...state.projects, [workspaceId]: result.data } }))
    } catch (error) {
      set((state) => ({
        errors: { ...state.errors, [workspaceId]: error instanceof Error ? error.message : '项目设置请求失败' }
      }))
    } finally {
      set((state) => ({ loading: { ...state.loading, [workspaceId]: false } }))
    }
  }

  return {
    projects: {}, loading: {}, errors: {},
    load: (id) => request(id, () => window.agent.settings.getAgentProject(id)),
    setPermissionMode: async (id, permissionMode) => {
      const current = get().projects[id]
      if (!current) return
      await request(id, () => window.agent.settings.setAgentProject({ ...current.preferences, permissionMode }))
    },
    setExecutionEnvironment: async (id, executionEnvironment) => {
      const current = get().projects[id]
      if (!current) return
      await request(id, () => window.agent.settings.setAgentProject({ ...current.preferences, executionEnvironment }))
    },
    setDockerImage: async (id, dockerImageId) => {
      const current = get().projects[id]
      if (!current) return
      await request(id, () => window.agent.settings.setAgentProject({ ...current.preferences, dockerImageId }))
    }
  }
})
