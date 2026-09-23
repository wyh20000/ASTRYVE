import { create } from 'zustand'
import type { Attachment } from '@shared/types'

export interface InputDraft {
  value: string
  attachments: Attachment[]
  processingFiles: Array<{ id: string; name: string; kind: 'image' | 'file' }>
}

export const EMPTY_DRAFT: InputDraft = { value: '', attachments: [], processingFiles: [] }

const WIDTH_KEY = 'ai-agent:sidebar-width'
const WORKSPACE_WIDTH_KEY = 'ai-agent:workspace-width'

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    if (v >= 180 && v <= 400) return v
  } catch {
    /* ignore */
  }
  return 220
}

function readWorkspaceWidth(): number {
  try {
    const value = Number(localStorage.getItem(WORKSPACE_WIDTH_KEY))
    if (value >= 420 && value <= 1100) return value
  } catch { /* ignore */ }
  return 720
}

interface UiState {
  sidebarOpen: boolean
  sidebarWidth: number
  settingsOpen: boolean
  workspaceOpen: boolean
  workspaceWidth: number
  searchQuery: string
  drafts: Record<string, InputDraft>
  updateDraft: (sessionId: string, update: (current: InputDraft) => InputDraft) => void
  clearDraft: (sessionId: string) => void
  clearDrafts: () => void
  toggleSidebar: () => void
  toggleWorkspace: () => void
  setWorkspaceWidth: (width: number) => void
  setSidebarWidth: (w: number) => void
  openSettings: () => void
  closeSettings: () => void
  setSearchQuery: (q: string) => void
  /** 一次性填入指定会话的文本；id 避免旧输入框清除较新的注入。 */
  pendingPrompt?: { id: number; text: string; sessionId: string }
  setPendingPrompt: (text: string, sessionId: string) => void
  clearPendingPrompt: (id?: number) => void
}

let pendingPromptId = 0

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  sidebarWidth: readWidth(),
  settingsOpen: false,
  workspaceOpen: true,
  workspaceWidth: readWorkspaceWidth(),
  searchQuery: '',
  drafts: {},
  updateDraft: (sessionId, update) => set((state) => ({
    drafts: { ...state.drafts, [sessionId]: update(state.drafts[sessionId] ?? EMPTY_DRAFT) }
  })),
  clearDraft: (sessionId) => set((state) => {
    const drafts = { ...state.drafts }
    delete drafts[sessionId]
    return { drafts }
  }),
  clearDrafts: () => set({ drafts: {} }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleWorkspace: () => set((s) => ({ workspaceOpen: !s.workspaceOpen })),
  setWorkspaceWidth: (width) => {
    set({ workspaceWidth: width })
    try { localStorage.setItem(WORKSPACE_WIDTH_KEY, String(width)) } catch { /* ignore */ }
  },
  setSidebarWidth: (w) => {
    set({ sidebarWidth: w })
    try {
      localStorage.setItem(WIDTH_KEY, String(w))
    } catch {
      /* ignore */
    }
  },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  pendingPrompt: undefined,
  setPendingPrompt: (text, sessionId) => set({
    pendingPrompt: { id: ++pendingPromptId, text, sessionId }
  }),
  clearPendingPrompt: (id) => set((state) =>
    id !== undefined && state.pendingPrompt?.id !== id ? state : { pendingPrompt: undefined })
}))
