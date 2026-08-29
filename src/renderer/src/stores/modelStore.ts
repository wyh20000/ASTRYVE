import { create } from 'zustand'
import type { ModelConfig, ModelPreset, ModelTestResult, ReasoningEffort } from '@shared/types'

interface ModelState {
  config: ModelConfig | null
  loading: boolean
  load: () => Promise<void>
  save: (cfg: Partial<ModelConfig>) => Promise<boolean>
  activate: (id: string) => Promise<void>
  setReasoning: (effort: ReasoningEffort) => Promise<void>
  test: (preset?: ModelPreset) => Promise<ModelTestResult | null>
}

export const useModelStore = create<ModelState>((set) => ({
  config: null,
  loading: false,
  load: async () => {
    set({ loading: true })
    const r = await window.agent.model.getConfig()
    if (r.ok) set({ config: r.data, loading: false })
    else set({ loading: false })
  },
  save: async (cfg) => {
    const r = await window.agent.model.setConfig(cfg)
    if (r.ok) {
      set({ config: r.data })
      return true
    }
    return false
  },
  activate: async (id) => {
    const r = await window.agent.model.setActive(id)
    if (r.ok) set({ config: r.data })
  },
  setReasoning: async (effort) => {
    const r = await window.agent.model.setReasoning(effort)
    if (r.ok) set({ config: r.data })
  },
  test: async (preset) => {
    const r = await window.agent.model.test(preset)
    return r.ok ? r.data : null
  }
}))
