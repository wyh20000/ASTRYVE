export type BrowserRisk = 'low' | 'medium' | 'high'
export interface BrowserStatus {
  available: boolean
  running: boolean
  executable?: string
  profilePath?: string
  reason?: string
  activeTabId?: string
}
export interface BrowserTab { id: string; title: string; url: string; active: boolean; pageVersion: number }
export interface BrowserElementRef { id: string; tabId: string; pageVersion: number }
export interface BrowserCallContext {
  callId: string
  source: string
  risk: BrowserRisk
  deadline: number
  signal?: AbortSignal
}
export interface BrowserInspectResult {
  title: string
  url: string
  text: string
  textTruncated: boolean
  readyState: 'loading' | 'interactive' | 'complete'
  meta: Record<string, string>
  outline: BrowserSemanticNode[]
  outlineTruncated: boolean
  pageVersion: number
}
export interface BrowserSemanticNode { role?: string; name?: string; tag: string; disabled: boolean }
export interface BrowserPerformanceSummary {
  navigationMs: number
  domContentLoadedMs: number
  resourceCount: number
  transferBytes: number
}
export interface BrowserDiagnostics {
  consoleErrors: string[]
  failedRequests: string[]
  performance: BrowserPerformanceSummary
}
export interface BrowserElementResult extends BrowserElementRef {
  role?: string
  name?: string
  tag?: string
  visible: boolean
  disabled: boolean
  sensitive?: boolean
  highRisk?: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}
