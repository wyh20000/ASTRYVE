import { create } from 'zustand'

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
  toggleSidebar: () => void
  toggleWorkspace: () => void
  setWorkspaceWidth: (width: number) => void
  setSidebarWidth: (w: number) => void
  openSettings: () => void
  closeSettings: () => void
  setSearchQuery: (q: string) => void
  /** 待填入对话输入框的文本；消费一次后清空 */
  pendingPrompt?: string
  setPendingPrompt: (text: string) => void
  consumePendingPrompt: () => string | undefined
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: true,
  sidebarWidth: readWidth(),
  settingsOpen: false,
  workspaceOpen: true,
  workspaceWidth: readWorkspaceWidth(),
  searchQuery: '',
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
  setPendingPrompt: (text) => set({ pendingPrompt: text }),
  consumePendingPrompt: () => {
    const text = get().pendingPrompt
    if (text !== undefined) set({ pendingPrompt: undefined })
    return text
  }
}))
