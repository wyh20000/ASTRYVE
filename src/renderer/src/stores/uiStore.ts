import { create } from 'zustand'

const WIDTH_KEY = 'ai-agent:sidebar-width'

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    if (v >= 180 && v <= 400) return v
  } catch {
    /* ignore */
  }
  return 220
}

interface UiState {
  sidebarOpen: boolean
  sidebarWidth: number
  settingsOpen: boolean
  searchQuery: string
  toggleSidebar: () => void
  setSidebarWidth: (w: number) => void
  openSettings: () => void
  closeSettings: () => void
  setSearchQuery: (q: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  sidebarWidth: readWidth(),
  settingsOpen: false,
  searchQuery: '',
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
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
  setSearchQuery: (q) => set({ searchQuery: q })
}))