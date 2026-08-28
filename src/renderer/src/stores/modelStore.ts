import { create } from 'zustand'
import type { ModelConfig, ModelTestResult } from '@shared/types'

interface ModelState {
  config: ModelConfig | null
  loading: boolean
  load: () => Promise<void>
  save: (cfg: Partial<ModelConfig>) => Promise<boolean>
  test: () => Promise<ModelTestResult | null>
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
  test: async () => {
    const r = await window.agent.model.test()
    return r.ok ? r.data : null
  }
}))