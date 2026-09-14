import { create } from 'zustand'
import type { PluginBackup, PluginImportKind, PluginMarketEntry, PluginMarketSource, PluginMetadata, PluginPreferences } from '@shared/types'

interface PluginState {
  items: PluginMetadata[]
  loading: boolean
  mutating: boolean
  error?: string
  marketEntries: PluginMarketEntry[]
  marketSources: PluginMarketSource[]
  preferences: PluginPreferences
  load: () => Promise<void>
  importLocal: (kind: PluginImportKind) => Promise<boolean>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  recover: (id: string) => Promise<void>
  loadMarketplace: () => Promise<void>
  addSource: (name: string, url: string, signingKeyId?: string, signingPublicKey?: string) => Promise<boolean>
  setSourceEnabled: (id: string, enabled: boolean) => Promise<void>
  removeSource: (id: string) => Promise<void>
  syncSource: (id: string) => Promise<void>
  installMarket: (sourceId: string, id: string, version: string) => Promise<boolean>
  uninstall: (id: string, dataDisposition?: 'keep' | 'clear') => Promise<void>
  loadBackups: (id: string) => Promise<PluginBackup[]>
  rollback: (id: string, version: string) => Promise<boolean>
  loadPreferences: () => Promise<void>
  setAutoUpdate: (enabled: boolean) => Promise<void>
}

export const usePluginStore = create<PluginState>((set) => ({
  items: [], marketEntries: [], marketSources: [], preferences: { autoUpdate: false }, loading: false, mutating: false,
  load: async () => {
    set({ loading: true, error: undefined })
    const result = await window.agent.plugins.list()
    if (result.ok) set({ items: result.data, loading: false })
    else set({ error: result.error.message, loading: false })
  },
  importLocal: async (kind) => {
    set({ mutating: true, error: undefined })
    const result = await window.agent.plugins.importLocal({ kind })
    if (result.ok) { set({ items: result.data, mutating: false }); return true }
    set({ error: result.error.message, mutating: false }); return false
  },
  setEnabled: async (id, enabled) => {
    const result = await window.agent.plugins.setEnabled({ id, enabled })
    if (result.ok) set({ items: result.data, error: undefined })
    else set({ error: result.error.message })
  },
  recover: async (id) => {
    const result = await window.agent.plugins.recover({ id })
    if (result.ok) set({ items: result.data, error: undefined })
    else set({ error: result.error.message })
  },
  loadMarketplace: async () => {
    set({ loading: true, error: undefined })
    const result = await window.agent.plugins.marketplace()
    if (result.ok) set({ marketEntries: result.data.entries, marketSources: result.data.sources, loading: false })
    else set({ error: result.error.message, loading: false })
  },
  addSource: async (name, url, signingKeyId, signingPublicKey) => {
    set({ mutating: true, error: undefined })
    const result = await window.agent.plugins.addSource({ name, url, signingKeyId, signingPublicKey })
    if (result.ok) { set({ marketEntries: result.data.entries, marketSources: result.data.sources, mutating: false }); return true }
    set({ error: result.error.message, mutating: false }); return false
  },
  setSourceEnabled: async (id, enabled) => {
    const result = await window.agent.plugins.setSourceEnabled({ id, enabled })
    if (result.ok) set({ marketEntries: result.data.entries, marketSources: result.data.sources })
    else set({ error: result.error.message })
  },
  removeSource: async (id) => {
    const result = await window.agent.plugins.removeSource({ id })
    if (result.ok) set({ marketEntries: result.data.entries, marketSources: result.data.sources })
    else set({ error: result.error.message })
  },
  syncSource: async (id) => {
    set({ mutating: true, error: undefined })
    const result = await window.agent.plugins.syncSource({ id })
    if (result.ok) set({ marketEntries: result.data.entries, marketSources: result.data.sources, mutating: false })
    else set({ error: result.error.message, mutating: false })
  },
  installMarket: async (sourceId, id, version) => {
    set({ mutating: true, error: undefined })
    const result = await window.agent.plugins.installMarket({ sourceId, id, version })
    if (result.ok) { set({ items: result.data, mutating: false }); return true }
    set({ error: result.error.message, mutating: false }); return false
  },
  uninstall: async (id, dataDisposition = 'keep') => {
    const result = await window.agent.plugins.uninstall({ id, dataDisposition })
    if (result.ok) set({ items: result.data, error: undefined })
    else set({ error: result.error.message })
  },
  loadBackups: async (id) => {
    const result = await window.agent.plugins.backups({ id })
    if (result.ok) return result.data
    set({ error: result.error.message })
    return []
  },
  rollback: async (id, version) => {
    set({ mutating: true, error: undefined })
    const result = await window.agent.plugins.rollback({ id, version })
    if (result.ok) { set({ items: result.data, mutating: false }); return true }
    set({ error: result.error.message, mutating: false }); return false
  },
  loadPreferences: async () => {
    const result = await window.agent.plugins.getPreferences()
    if (result.ok) set({ preferences: result.data })
    else set({ error: result.error.message })
  },
  setAutoUpdate: async (enabled) => {
    const result = await window.agent.plugins.setPreferences({ autoUpdate: enabled })
    if (result.ok) set({ preferences: result.data, error: undefined })
    else set({ error: result.error.message })
  }
}))
