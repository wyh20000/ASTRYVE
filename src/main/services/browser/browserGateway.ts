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
  inspect(tabId: string): Promise<{ title: string; url: string; text: string; readyState: string; meta: Record<string, string>; outline: BrowserSemanticNode[] }>
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

  async listTabs(context?: BrowserCallContext): Promise<BrowserTab[]> {
    return (await this.withReadPermit(() => this.adapter.listTabs(), context)).map((tab) => ({ ...tab, pageVersion: this.version(tab.id) }))
  }

  async assertTabOrigin(tabId: string, rawUrl: string, context?: BrowserCallContext): Promise<void> {
    const expected = new URL(safeWebUrl(rawUrl)).origin.toLowerCase()
    const actual = (await this.withReadPermit(() => this.adapter.listTabs(), context)).find((tab) => tab.id === tabId)
    if (!actual) throw new Error('浏览器标签页不存在')
    let actualOrigin: string
    try { actualOrigin = new URL(actual.url).origin.toLowerCase() } catch { throw new Error('标签页地址不可审核') }
    if (actualOrigin !== expected) throw new Error('标签页地址已变化，请刷新标签页列表后重试')
    if (this.canNavigate && !this.canNavigate(new URL(actual.url))) throw new Error('该网站已被浏览器设置阻止')
  }

  async navigate(tabId: string, rawUrl: string, context?: BrowserCallContext): Promise<void> {
    const url = safeWebUrl(rawUrl)
    if (this.canNavigate && !this.canNavigate(new URL(url))) throw new Error('该网站已被浏览器设置阻止')
    await this.withOptionalDeadline(context, () => this.adapter.navigate(tabId, url))
    this.versions.set(tabId, this.version(tabId) + 1)
    for (const [id, record] of this.elements) if (record.ref.tabId === tabId) this.elements.delete(id)
  }

  async createTab(rawUrl = 'about:blank', context?: BrowserCallContext): Promise<string> {
    const url = rawUrl === 'about:blank' ? rawUrl : safeWebUrl(rawUrl)
    if (url !== 'about:blank' && this.canNavigate && !this.canNavigate(new URL(url))) throw new Error('该网站已被浏览器设置阻止')
    const id = await this.withOptionalDeadline(context, () => this.adapter.createTab(url))
    this.versions.set(id, 1)
    return id
  }
  async selectTab(tabId: string, context?: BrowserCallContext): Promise<void> { await this.withOptionalDeadline(context, () => this.adapter.activateTab(tabId)) }
  async closeTab(tabId: string, context?: BrowserCallContext): Promise<void> { await this.withOptionalDeadline(context, () => this.adapter.closeTab(tabId)); this.versions.delete(tabId) }
  async history(tabId: string, direction: 'back' | 'forward', context?: BrowserCallContext): Promise<void> { await this.withOptionalDeadline(context, () => this.adapter.history(tabId, direction)); this.bump(tabId) }
  async reload(tabId: string, context?: BrowserCallContext): Promise<void> { await this.withOptionalDeadline(context, () => this.adapter.reload(tabId)); this.bump(tabId) }

  async inspect(tabId: string, context?: BrowserCallContext): Promise<BrowserInspectResult> {
    const result = await this.withReadPermit(() => this.adapter.inspect(tabId), context)
    return {
      title: clean(result.title, 500),
      url: safeDisplayUrl(result.url),
      text: clean(result.text, this.maxText),
      textTruncated: result.text.length > this.maxText,
      readyState: normalizeReadyState(result.readyState),
      meta: cleanMetadata(result.meta),
      outline: cleanOutline(result.outline),
      outlineTruncated: result.outline.length > 200,
      pageVersion: this.version(tabId)
    }
  }

  async waitForPage(tabId: string, rawUrl: string, timeoutMs: number, context: BrowserCallContext): Promise<BrowserInspectResult> {
    this.assertContext(context)
    const expectedOrigin = new URL(safeWebUrl(rawUrl)).origin.toLowerCase()
    const deadline = Math.min(context.deadline, Date.now() + Math.max(100, Math.min(timeoutMs, 30_000)))
    while (Date.now() < deadline) {
      const result = await this.inspect(tabId, { ...context, deadline })
      let currentOrigin = ''
      try { currentOrigin = new URL(result.url).origin.toLowerCase() } catch { /* still loading */ }
      if (result.readyState === 'complete' && currentOrigin === expectedOrigin) return result
      await pause(Math.min(100, Math.max(1, deadline - Date.now())), context.signal)
    }
    throw new Error('等待页面稳定超时')
  }

  async find(tabId: string, locator: BrowserLocator, context?: BrowserCallContext): Promise<BrowserElementResult[]> {
    if (!locator || !Object.values(locator).some((value) => typeof value === 'string' && value.trim())) throw new Error('元素定位条件无效')
    const version = this.version(tabId)
    return (await this.withReadPermit(() => this.adapter.find(tabId, locator), context)).slice(0, 100).map((item) => {
      const id = `element-${randomUUID()}`
      const ref: BrowserElementResult = {
        id, tabId, pageVersion: version, role: short(item.role), name: short(item.name), tag: short(item.tag),
        visible: Boolean(item.visible), disabled: Boolean(item.disabled), sensitive: Boolean(item.sensitive),
        highRisk: Boolean(item.highRisk), bounds: item.bounds
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
    if (action.type === 'type' && record.ref.sensitive) throw new Error('敏感字段必须由用户接管输入')
    if (record.ref.highRisk && !['hover', 'scroll'].includes(action.type) && context.risk !== 'high') {
      throw new Error('高风险网页动作必须使用确认工具并单次审批')
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

  async screenshot(tabId: string, reference?: BrowserElementRef, context?: BrowserCallContext): Promise<Buffer> {
    let backendNodeId: number | undefined
    if (reference) {
      const record = this.elements.get(reference.id)
      if (!record || record.ref.tabId !== tabId || reference.tabId !== tabId) throw new Error('元素引用不属于当前标签页')
      if (record.ref.pageVersion !== reference.pageVersion || reference.pageVersion !== this.version(tabId)) throw new Error('元素引用已过期，请重新定位')
      backendNodeId = record.backendNodeId
    }
    const image = await this.withReadPermit(() => this.adapter.screenshot(tabId, backendNodeId), context)
    if (image.byteLength > 10 * 1024 * 1024) throw new Error('截图超过大小限制')
    return image
  }

  async diagnostics(tabId: string, context?: BrowserCallContext): Promise<BrowserDiagnostics> {
    const result = await this.withReadPermit(() => this.adapter.diagnostics(tabId), context)
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

  private async withOptionalDeadline<T>(context: BrowserCallContext | undefined, action: () => Promise<T>): Promise<T> {
    if (!context) return action()
    this.assertContext(context)
    return this.withDeadline(context, action)
  }

  private async withReadPermit<T>(action: () => Promise<T>, context?: BrowserCallContext): Promise<T> {
    if (context) this.assertContext(context)
    if (this.activeReads >= this.maxConcurrentReads) await new Promise<void>((resolve) => this.readWaiters.push(resolve))
    this.activeReads += 1
    try { return context ? await this.withDeadline(context, action) : await action() }
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
function normalizeReadyState(value: string): BrowserInspectResult['readyState'] {
  return value === 'complete' || value === 'interactive' ? value : 'loading'
}
function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const finish = (): void => { signal?.removeEventListener('abort', aborted); resolve() }
    const timer = setTimeout(finish, milliseconds)
    const aborted = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(new Error('浏览器操作已取消')) }
    signal?.addEventListener('abort', aborted, { once: true })
  })
}
