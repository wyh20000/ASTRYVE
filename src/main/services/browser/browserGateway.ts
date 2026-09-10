import { randomUUID } from 'node:crypto'
import type { BrowserCallContext, BrowserDiagnostics, BrowserElementRef, BrowserElementResult, BrowserInspectResult, BrowserSemanticNode, BrowserTab } from '../../../shared/browser'

export interface BrowserAdapter {
  listTabs(): Promise<Array<Omit<BrowserTab, 'pageVersion'>>>
  createTab(url: string): Promise<string>
  activateTab(tabId: string): Promise<void>
  closeTab(tabId: string): Promise<void>
  history(tabId: string, direction: 'back' | 'forward'): Promise<void>
  reload(tabId: string): Promise<void>
  navigate(tabId: string, url: string): Promise<void>
  inspect(tabId: string): Promise<{ title: string; url: string; text: string; meta: Record<string, string>; outline: BrowserSemanticNode[] }>
  find(tabId: string, locator: BrowserLocator): Promise<Array<Omit<BrowserElementResult, 'id' | 'tabId' | 'pageVersion'> & { backendNodeId: number }>>
  interact(tabId: string, backendNodeId: number, action: BrowserInteraction): Promise<unknown>
  drag(tabId: string, sourceBackendNodeId: number, targetBackendNodeId: number): Promise<unknown>
  screenshot(tabId: string, elementBackendNodeId?: number): Promise<Buffer>
  diagnostics(tabId: string): Promise<BrowserDiagnostics>
}

export interface BrowserLocator { role?: string; tag?: string; text?: string; css?: string }
export type BrowserInteraction =
  | { type: 'click' | 'doubleClick' | 'hover' }
  | { type: 'type'; text: string; clear?: boolean }
  | { type: 'key'; key: string }
  | { type: 'scroll'; x?: number; y: number }
  | { type: 'select'; value: string }
  | { type: 'check'; checked: boolean }

interface ElementRecord { backendNodeId: number; ref: BrowserElementResult }

export class BrowserGateway {
  private readonly versions = new Map<string, number>()
  private readonly elements = new Map<string, ElementRecord>()
  private readonly writeQueues = new Map<string, Promise<unknown>>()
  private readonly readWaiters: Array<() => void> = []
  private activeReads = 0
  private readonly maxText: number
  private readonly maxConcurrentReads: number
  private readonly canNavigate?: (url: URL) => boolean
  constructor(private readonly adapter: BrowserAdapter, options: { maxText?: number; maxConcurrentReads?: number; canNavigate?: (url: URL) => boolean } = {}) {
    this.maxText = Math.max(20, Math.min(options.maxText ?? 64_000, 200_000))
    this.maxConcurrentReads = Math.max(1, Math.min(options.maxConcurrentReads ?? 4, 16))
    this.canNavigate = options.canNavigate
  }

  async listTabs(): Promise<BrowserTab[]> {
    return (await this.withReadPermit(() => this.adapter.listTabs())).map((tab) => ({ ...tab, pageVersion: this.version(tab.id) }))
  }

  async assertTabOrigin(tabId: string, rawUrl: string): Promise<void> {
    const expected = new URL(safeWebUrl(rawUrl)).origin.toLowerCase()
    const actual = (await this.withReadPermit(() => this.adapter.listTabs())).find((tab) => tab.id === tabId)
    if (!actual) throw new Error('浏览器标签页不存在')
    let actualOrigin: string
    try { actualOrigin = new URL(actual.url).origin.toLowerCase() } catch { throw new Error('标签页地址不可审核') }
    if (actualOrigin !== expected) throw new Error('标签页地址已变化，请刷新标签页列表后重试')
    if (this.canNavigate && !this.canNavigate(new URL(actual.url))) throw new Error('该网站已被浏览器设置阻止')
  }

  async navigate(tabId: string, rawUrl: string): Promise<void> {
    const url = safeWebUrl(rawUrl)
    if (this.canNavigate && !this.canNavigate(new URL(url))) throw new Error('该网站已被浏览器设置阻止')
    await this.adapter.navigate(tabId, url)
    this.versions.set(tabId, this.version(tabId) + 1)
    for (const [id, record] of this.elements) if (record.ref.tabId === tabId) this.elements.delete(id)
  }

  async createTab(rawUrl = 'about:blank'): Promise<string> {
    const url = rawUrl === 'about:blank' ? rawUrl : safeWebUrl(rawUrl)
    if (url !== 'about:blank' && this.canNavigate && !this.canNavigate(new URL(url))) throw new Error('该网站已被浏览器设置阻止')
    const id = await this.adapter.createTab(url)
    this.versions.set(id, 1)
    return id
  }
  async selectTab(tabId: string): Promise<void> { await this.adapter.activateTab(tabId) }
  async closeTab(tabId: string): Promise<void> { await this.adapter.closeTab(tabId); this.versions.delete(tabId) }
  async history(tabId: string, direction: 'back' | 'forward'): Promise<void> { await this.adapter.history(tabId, direction); this.bump(tabId) }
  async reload(tabId: string): Promise<void> { await this.adapter.reload(tabId); this.bump(tabId) }

  async inspect(tabId: string): Promise<BrowserInspectResult> {
    const result = await this.withReadPermit(() => this.adapter.inspect(tabId))
    return {
      title: clean(result.title, 500),
      url: safeDisplayUrl(result.url),
      text: clean(result.text, this.maxText),
      meta: cleanMetadata(result.meta),
      outline: cleanOutline(result.outline),
      pageVersion: this.version(tabId)
    }
  }

  async find(tabId: string, locator: BrowserLocator): Promise<BrowserElementResult[]> {
    if (!locator || !Object.values(locator).some((value) => typeof value === 'string' && value.trim())) throw new Error('元素定位条件无效')
    const version = this.version(tabId)
    return (await this.withReadPermit(() => this.adapter.find(tabId, locator))).slice(0, 100).map((item) => {
      const id = `element-${randomUUID()}`
      const ref: BrowserElementResult = {
        id, tabId, pageVersion: version, role: short(item.role), name: short(item.name), tag: short(item.tag),
        visible: Boolean(item.visible), disabled: Boolean(item.disabled), bounds: item.bounds
      }
      this.elements.set(id, { backendNodeId: item.backendNodeId, ref })
      return ref
    })
  }

  async interact(reference: BrowserElementRef, action: BrowserInteraction, context: BrowserCallContext): Promise<unknown> {
    this.assertContext(context)
    const record = this.elements.get(reference.id)
    if (!record || record.ref.tabId !== reference.tabId || record.ref.pageVersion !== reference.pageVersion || reference.pageVersion !== this.version(reference.tabId)) {
      throw new Error('元素引用已过期，请重新定位')
    }
    if (action.type === 'type' && sensitiveText(action.text)) throw new Error('疑似凭据或敏感内容，已阻止传给浏览器')
    const previous = this.writeQueues.get(reference.tabId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.withDeadline(context, () => this.adapter.interact(reference.tabId, record.backendNodeId, action)))
    this.writeQueues.set(reference.tabId, next)
    try { return await next } finally { if (this.writeQueues.get(reference.tabId) === next) this.writeQueues.delete(reference.tabId) }
  }

  async drag(source: BrowserElementRef, target: BrowserElementRef, context: BrowserCallContext): Promise<unknown> {
    this.assertContext(context)
    if (source.tabId !== target.tabId || source.pageVersion !== target.pageVersion || source.pageVersion !== this.version(source.tabId)) {
      throw new Error('拖放元素引用不属于同一页面或已过期')
    }
    const sourceRecord = this.elements.get(source.id)
    const targetRecord = this.elements.get(target.id)
    if (!sourceRecord || !targetRecord) throw new Error('拖放元素引用已过期，请重新定位')
    const previous = this.writeQueues.get(source.tabId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.withDeadline(context,
      () => this.adapter.drag(source.tabId, sourceRecord.backendNodeId, targetRecord.backendNodeId)))
    this.writeQueues.set(source.tabId, next)
    try { return await next } finally { if (this.writeQueues.get(source.tabId) === next) this.writeQueues.delete(source.tabId) }
  }

  async screenshot(tabId: string, reference?: BrowserElementRef): Promise<Buffer> {
    let backendNodeId: number | undefined
    if (reference) {
      const record = this.elements.get(reference.id)
      if (!record || record.ref.tabId !== tabId || reference.tabId !== tabId) throw new Error('元素引用不属于当前标签页')
      if (record.ref.pageVersion !== reference.pageVersion || reference.pageVersion !== this.version(tabId)) throw new Error('元素引用已过期，请重新定位')
      backendNodeId = record.backendNodeId
    }
    const image = await this.withReadPermit(() => this.adapter.screenshot(tabId, backendNodeId))
    if (image.byteLength > 10 * 1024 * 1024) throw new Error('截图超过大小限制')
    return image
  }

  async diagnostics(tabId: string): Promise<BrowserDiagnostics> {
    const result = await this.withReadPermit(() => this.adapter.diagnostics(tabId))
    return {
      consoleErrors: result.consoleErrors.slice(-100).map((v) => clean(v, 1000)),
      failedRequests: result.failedRequests.slice(-100).map((v) => clean(v, 1000)),
      performance: {
        navigationMs: finiteMetric(result.performance.navigationMs),
        domContentLoadedMs: finiteMetric(result.performance.domContentLoadedMs),
        resourceCount: finiteMetric(result.performance.resourceCount),
        transferBytes: finiteMetric(result.performance.transferBytes)
      }
    }
  }

  private version(tabId: string): number { return this.versions.get(tabId) ?? 1 }
  private bump(tabId: string): void {
    this.versions.set(tabId, this.version(tabId) + 1)
    for (const [id, record] of this.elements) if (record.ref.tabId === tabId) this.elements.delete(id)
  }
  private assertContext(context: BrowserCallContext): void {
    if (!context.callId || !context.source || !['low', 'medium', 'high'].includes(context.risk) || !Number.isFinite(context.deadline)) {
      throw new Error('浏览器调用上下文无效')
    }
    if (context.signal?.aborted) throw new Error('浏览器操作已取消')
    if (Date.now() >= context.deadline) throw new Error('浏览器操作已超时')
  }
  private async withDeadline<T>(context: BrowserCallContext, action: () => Promise<T>): Promise<T> {
    const remaining = Math.max(1, context.deadline - Date.now())
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('浏览器操作已超时')), remaining)
      const aborted = (): void => reject(new Error('浏览器操作已取消'))
      context.signal?.addEventListener('abort', aborted, { once: true })
      action().then(resolve, reject).finally(() => { clearTimeout(timer); context.signal?.removeEventListener('abort', aborted) })
    })
  }

  private async withReadPermit<T>(action: () => Promise<T>): Promise<T> {
    if (this.activeReads >= this.maxConcurrentReads) await new Promise<void>((resolve) => this.readWaiters.push(resolve))
    this.activeReads += 1
    try { return await action() }
    finally {
      this.activeReads -= 1
      this.readWaiters.shift()?.()
    }
  }
}

function safeWebUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('网页地址无效') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只允许打开 HTTP(S) 网页')
  url.username = ''; url.password = ''; return url.toString()
}
function safeDisplayUrl(raw: string): string { try { return safeWebUrl(raw).slice(0, 2048) } catch { return '' } }
function sensitiveText(value: string): boolean { return /(?:password|passwd|secret|token|api[_-]?key|验证码|信用卡)/i.test(value) }
function clean(value: string, max: number): string {
  const redacted = value.replace(/(?:bearer\s+|password\s*[=:]\s*|token\s*[=:]\s*)[^\s,;]+/gi, '[已脱敏]')
  return redacted.slice(0, max)
}
function short(value: string | undefined): string | undefined { return value ? clean(value, 300) : undefined }
function cleanMetadata(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, child]) => [clean(key, 100), clean(child, 500)]))
}
function cleanOutline(value: BrowserSemanticNode[]): BrowserSemanticNode[] {
  return value.slice(0, 200).map((node) => ({
    role: short(node.role),
    name: node.name && sensitiveText(node.name) ? '[已脱敏]' : short(node.name),
    tag: clean(node.tag, 50),
    disabled: Boolean(node.disabled)
  }))
}
function finiteMetric(value: number): number { return Number.isFinite(value) && value > 0 ? Math.round(value) : 0 }
