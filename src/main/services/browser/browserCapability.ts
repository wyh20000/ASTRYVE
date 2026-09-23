import { randomUUID } from 'node:crypto'
import type { AuditEvent, ToolDefinition, ToolExecutionContext } from '../../../shared/agent'
import type { BrowserTab } from '../../../shared/browser'
import type { BrowserGateway } from './browserGateway'

export type BrowserPurpose = 'inspect' | 'screenshot' | 'diagnose' | 'interact'
interface ActivateArgs { purpose: BrowserPurpose; targetHint?: { url?: string; title?: string } }
interface ActivationState {
  purpose: BrowserPurpose
  status: 'activated' | 'needs-selection'
  mcpGeneration: number
  pages: Array<Pick<BrowserTab, 'id' | 'title' | 'url'>>
  release?: () => Promise<void>
}
type PageChoice = (pages: ActivationState['pages'], signal: AbortSignal) => Promise<string | undefined>

const PURPOSE_TOOLS: Record<BrowserPurpose, readonly string[]> = {
  inspect: ['browser.waitForPage', 'browser.inspect', 'browser.find'],
  screenshot: ['browser.waitForPage', 'browser.inspect', 'browser.screenshot'],
  diagnose: ['browser.inspect', 'browser.diagnostics'],
  interact: [
    'browser.openTab', 'browser.closeTab', 'browser.selectTab',
    'browser.navigate', 'browser.history', 'browser.reload', 'browser.waitForPage',
    'browser.inspect', 'browser.find', 'browser.click', 'browser.confirmClick',
    'browser.doubleClick', 'browser.hover', 'browser.scroll', 'browser.type',
    'browser.key', 'browser.select', 'browser.check', 'browser.drag'
  ]
}

/** Reply-scoped host capability. Constructing the tool does not connect to Chrome. */
export class BrowserCapability {
  private readonly active = new Map<string, ActivationState>()
  private readonly pageChoices = new Map<string, PageChoice>()

  constructor(
    private readonly gateway: BrowserGateway,
    private readonly acquireLease: () => () => Promise<void>,
    private readonly audit: (event: AuditEvent) => void,
    private readonly generation: () => number = () => 0
  ) {}

  tool(): ToolDefinition<ActivateArgs, unknown> {
    return {
      name: 'browser.activate',
      operation: 'browser.read',
      executionTimeoutMs: 5 * 60_000,
      description: 'Use only when the user needs live Chrome page state or browser action. Ordinary questions, supplied attachments and general knowledge do not need this tool. Activation only lists pages; it does not read page content or take a screenshot.',
      parameters: {
        type: 'object',
        properties: {
          purpose: { type: 'string', enum: ['inspect', 'screenshot', 'diagnose', 'interact'] },
          targetHint: {
            type: 'object',
            properties: { url: { type: 'string' }, title: { type: 'string' } },
            additionalProperties: false
          }
        },
        required: ['purpose'],
        additionalProperties: false
      },
      validateArgs: isActivateArgs,
      execute: async (args, context) => this.activate(args, context)
    }
  }

  allowedToolNames(taskId: string): ReadonlySet<string> {
    const state = this.active.get(taskId)
    return new Set(state?.status === 'activated' && state.mcpGeneration === this.generation()
      ? PURPOSE_TOOLS[state.purpose] : [])
  }

  isActivated(taskId: string): boolean {
    const state = this.active.get(taskId)
    return state?.status === 'activated' && state.mcpGeneration === this.generation()
  }

  setPageChoice(taskId: string, choose: PageChoice): void { this.pageChoices.set(taskId, choose) }

  /** Final model-call gate: exposed names alone never authorize another page ID. */
  mayUseTool(taskId: string, name: string, args: unknown): boolean {
    if (!name.startsWith('browser.') || name === 'browser.activate') return true
    const state = this.active.get(taskId)
    if (state?.status !== 'activated' || state.mcpGeneration !== this.generation() ||
        !PURPOSE_TOOLS[state.purpose].includes(name)) return false
    if (!args || typeof args !== 'object' || Array.isArray(args)) return false
    const fields = args as Record<string, unknown>
    const page = state.pages[0]
    if (!page) return false
    if (name === 'browser.openTab') return typeof fields.url === 'string' && Boolean(normalizeUrl(fields.url))
    if (fields.tabId !== page.id) return false
    if (typeof fields.url === 'string' && name !== 'browser.navigate' &&
        normalizeUrl(fields.url) !== normalizeUrl(page.url)) return false
    return true
  }

  /** Successful writes update or revoke the short-lived binding before the next model round. */
  async observeToolResult(taskId: string, name: string, args: unknown, result: unknown): Promise<void> {
    const state = this.active.get(taskId)
    if (state?.status !== 'activated' || state.mcpGeneration !== this.generation()) return
    const fields = args && typeof args === 'object' && !Array.isArray(args)
      ? args as Record<string, unknown> : {}
    const value = result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown> : {}
    if (name === 'browser.closeTab' || name === 'browser.history') {
      await this.revokeBinding(taskId)
    } else if (name === 'browser.openTab' && typeof value.tabId === 'string' && typeof fields.url === 'string') {
      state.pages = [{ id: value.tabId, url: normalizeUrl(fields.url),
        title: typeof value.title === 'string' ? sanitizeTitle(value.title) : '' }]
    } else if (name === 'browser.navigate' && typeof fields.url === 'string') {
      state.pages = [{ ...state.pages[0], url: normalizeUrl(fields.url) }]
    } else if (name === 'browser.inspect' && typeof value.url === 'string' && normalizeUrl(value.url)) {
      state.pages = [{ ...state.pages[0], url: normalizeUrl(value.url) }]
    }
  }

  async release(taskId: string): Promise<void> {
    this.pageChoices.delete(taskId)
    await this.revokeBinding(taskId)
  }

  private async revokeBinding(taskId: string): Promise<void> {
    const state = this.active.get(taskId)
    this.active.delete(taskId)
    await state?.release?.()
  }

  async releaseAll(): Promise<void> {
    await Promise.all([...new Set([...this.active.keys(), ...this.pageChoices.keys()])]
      .map((taskId) => this.release(taskId)))
  }

  private async activate(args: ActivateArgs, context: ToolExecutionContext) {
    const existing = this.active.get(context.taskId)
    if (existing?.mcpGeneration === this.generation()) return { ok: true as const, value: publicState(existing) }
    if (existing) await this.revokeBinding(context.taskId)
    this.record(context, 'ask', 'requested', args.purpose)
    const release = this.acquireLease()
    try {
      const pages = (await this.gateway.listTabs({
        callId: context.callId, source: 'browser.activate', risk: 'low',
        deadline: Date.now() + 30_000, signal: context.signal
      })).filter((page) => page.url && /^https?:\/\//i.test(page.url))
        .map(({ id, title, url }) => ({ id, title: sanitizeTitle(title), url }))
      if (context.signal.aborted) throw new Error('浏览器激活已取消')
      const matched = matchPages(pages, args.targetHint)
      let selected = matched.length === 1 ? matched : pages.length === 1 ? pages : []
      if (!selected.length && pages.length >= 2 && pages.length <= 7) {
        const choose = this.pageChoices.get(context.taskId)
        if (choose) {
          this.record(context, 'ask', 'needs-selection', args.purpose)
          const pageId = await choose(pages, context.signal)
          if (context.signal.aborted) throw new Error('页面选择已取消')
          selected = pages.filter((page) => page.id === pageId)
        }
      }
      const state: ActivationState = selected.length === 1
        ? { purpose: args.purpose, status: 'activated', mcpGeneration: this.generation(), pages: selected, release }
        : { purpose: args.purpose, status: 'needs-selection', mcpGeneration: this.generation(), pages: pages.slice(0, 20) }
      this.active.set(context.taskId, state)
      if (state.status === 'needs-selection') {
        await release()
        state.mcpGeneration = this.generation()
      }
      this.record(context, 'success', state.status, args.purpose)
      return { ok: true as const, value: publicState(state) }
    } catch (error) {
      await release()
      this.record(context, 'failure', 'failed', args.purpose)
      return { ok: false as const, error: {
        code: 'BROWSER_ACTIVATION_FAILED',
        message: error instanceof Error ? error.message : '浏览器激活失败'
      } }
    }
  }

  private record(context: ToolExecutionContext, outcome: AuditEvent['outcome'], status: string, purpose: BrowserPurpose): void {
    this.audit({
      id: randomUUID(), timestamp: Date.now(), taskId: context.taskId,
      workspaceId: context.workspace.id, actor: 'model', action: 'browser.activate', outcome,
      metadata: { status, purpose }
    })
  }
}

function publicState(state: ActivationState): Record<string, unknown> {
  return {
    status: state.status,
    purpose: state.purpose,
    pages: state.pages,
    message: state.status === 'needs-selection'
      ? '无法唯一确定页面。本轮不会读取或截图；请让用户明确指定目标页面。'
      : '浏览器能力已激活，可在下一轮使用当前用途的工具。'
  }
}

function matchPages(pages: ActivationState['pages'], hint?: ActivateArgs['targetHint']): ActivationState['pages'] {
  if (!hint) return []
  const url = hint.url ? normalizeUrl(hint.url) : undefined
  const title = hint.title?.trim().toLocaleLowerCase('en-US')
  return pages.filter((page) => (!url || normalizeUrl(page.url) === url) &&
    (!title || page.title.trim().toLocaleLowerCase('en-US') === title))
}

function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.username = ''; url.password = ''; url.search = ''; url.hash = ''
    return url.toString()
  } catch { return '' }
}

function sanitizeTitle(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
}

function isActivateArgs(value: unknown): value is ActivateArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const args = value as Record<string, unknown>
  if (!['inspect', 'screenshot', 'diagnose', 'interact'].includes(String(args.purpose)) ||
      Object.keys(args).some((key) => !['purpose', 'targetHint'].includes(key))) return false
  if (args.targetHint === undefined) return true
  if (!args.targetHint || typeof args.targetHint !== 'object' || Array.isArray(args.targetHint)) return false
  const hint = args.targetHint as Record<string, unknown>
  return Object.keys(hint).every((key) => ['url', 'title'].includes(key)) &&
    (hint.url === undefined || (typeof hint.url === 'string' && hint.url.length <= 2048 && Boolean(normalizeUrl(hint.url)))) &&
    (hint.title === undefined || (typeof hint.title === 'string' && hint.title.length <= 160))
}
