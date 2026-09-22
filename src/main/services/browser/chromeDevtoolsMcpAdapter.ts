import type {
  BrowserCallContext,
  BrowserDiagnostics,
  BrowserElementResult,
  BrowserSemanticNode,
  BrowserTab
} from '../../../shared/browser'
import type {
  BrowserAdapter,
  BrowserInteraction,
  BrowserLocator
} from './browserGateway'
import type {
  ChromeDevtoolsMcpResult,
  ChromeDevtoolsMcpSession
} from './chromeDevtoolsMcpClient'

interface OfficialPage {
  id: number
  url: string
  title: string
  selected: boolean
}

interface SnapshotNode {
  id: string
  role?: string
  name?: string
  disabled?: boolean
  children?: SnapshotNode[]
  [key: string]: unknown
}

interface ElementHandle {
  tabId: string
  uid: string
}

const MAX_ELEMENT_HANDLES = 5_000
const PAGE_INSPECTION_FUNCTION = `() => ({
  title: document.title,
  url: location.href,
  text: document.body?.innerText ?? '',
  readyState: document.readyState,
  meta: Object.fromEntries(Array.from(document.querySelectorAll('meta[name],meta[property]'))
    .slice(0, 50)
    .map((node) => [node.getAttribute('name') || node.getAttribute('property') || '', node.getAttribute('content') || '']))
})`
const PAGE_STATE_FUNCTION = `() => ({
  title: document.title,
  url: location.href,
  readyState: document.readyState,
  pendingImages: Array.from(document.images).filter((image) => !image.complete).length,
  fontsLoaded: !document.fonts || document.fonts.status === 'loaded',
  resourceCount: performance.getEntriesByType('resource').length,
  scrollHeight: document.documentElement?.scrollHeight || document.body?.scrollHeight || 0
})`
const PERFORMANCE_FUNCTION = `() => {
  const navigation = performance.getEntriesByType('navigation')[0]
  const resources = performance.getEntriesByType('resource')
  return {
    navigationMs: navigation?.duration ?? 0,
    domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
    resourceCount: resources.length,
    transferBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0)
  }
}`

/** Maps Google's documented Chrome DevTools MCP tools into the host BrowserAdapter contract. */
export class ChromeDevtoolsMcpAdapter implements BrowserAdapter {
  private nextElementId = 1
  private readonly elements = new Map<number, ElementHandle>()

  constructor(private readonly session: ChromeDevtoolsMcpSession) {}

  async listTabs(context?: BrowserCallContext): Promise<Array<Omit<BrowserTab, 'pageVersion'>>> {
    const pages = pagesFrom(await this.call('list_pages', {}, context))
    return pages.map((page) => ({
      id: String(page.id),
      title: page.title,
      url: page.url,
      active: page.selected
    }))
  }

  async createTab(url: string, context?: BrowserCallContext): Promise<string> {
    const before = new Set((await this.listTabs(context)).map((page) => page.id))
    const pages = pagesFrom(await this.call('new_page', { url, background: false }, context))
    const created = pages.find((page) => !before.has(String(page.id))) ??
      pages.find((page) => page.selected && page.url === url)
    if (!created) throw new Error('Chrome DevTools MCP 未返回新标签页')
    return String(created.id)
  }

  async activateTab(tabId: string, context?: BrowserCallContext): Promise<void> {
    await this.call('select_page', { pageId: pageId(tabId), bringToFront: true }, context)
  }

  async closeTab(tabId: string, context?: BrowserCallContext): Promise<void> {
    const pages = await this.listTabs(context)
    const target = pages.find((page) => page.id === tabId)
    if (!target) throw new Error('Chrome 标签页不存在或已经关闭')
    if (pages.length === 1) throw new Error('Google 官方 MCP 不允许关闭最后一个标签页')
    if (target.active) {
      const fallback = pages.find((page) => page.id !== tabId)
      if (!fallback) throw new Error('Google 官方 MCP 不允许关闭最后一个标签页')
      await this.call('select_page', {
        pageId: pageId(fallback.id),
        bringToFront: false
      }, context)
    }
    await this.call('close_page', { pageId: pageId(tabId) }, context)
    this.clearTabElements(tabId)
  }

  async history(
    tabId: string,
    direction: 'back' | 'forward',
    context?: BrowserCallContext
  ): Promise<void> {
    await this.call('navigate_page', { pageId: pageId(tabId), type: direction }, context)
    this.clearTabElements(tabId)
  }

  async reload(tabId: string, context?: BrowserCallContext): Promise<void> {
    await this.call('navigate_page', { pageId: pageId(tabId), type: 'reload' }, context)
    this.clearTabElements(tabId)
  }

  async navigate(tabId: string, url: string, context?: BrowserCallContext): Promise<void> {
    await this.call('navigate_page', {
      pageId: pageId(tabId),
      type: 'url',
      url
    }, context)
    this.clearTabElements(tabId)
  }

  async pageState(tabId: string, context?: BrowserCallContext): Promise<{
    title: string
    url: string
    readyState: string
    pendingImages: number
    fontsLoaded: boolean
    resourceCount: number
    scrollHeight: number
  }> {
    const state = await this.evaluate(tabId, PAGE_STATE_FUNCTION, context)
    if (!record(state) || typeof state.title !== 'string' ||
        typeof state.url !== 'string' || typeof state.readyState !== 'string' ||
        !Number.isSafeInteger(state.pendingImages) || typeof state.fontsLoaded !== 'boolean' ||
        !Number.isSafeInteger(state.resourceCount) || !Number.isFinite(state.scrollHeight)) {
      throw new Error('Chrome DevTools MCP 页面状态无效')
    }
    return {
      title: state.title,
      url: state.url,
      readyState: state.readyState,
      pendingImages: Number(state.pendingImages),
      fontsLoaded: state.fontsLoaded,
      resourceCount: Number(state.resourceCount),
      scrollHeight: Number(state.scrollHeight)
    }
  }

  async inspect(tabId: string, context?: BrowserCallContext): Promise<{
    title: string
    url: string
    text: string
    readyState: string
    meta: Record<string, string>
    outline: BrowserSemanticNode[]
  }> {
    const [inspection, snapshot] = await Promise.all([
      this.evaluate(tabId, PAGE_INSPECTION_FUNCTION, context),
      this.snapshot(tabId, context)
    ])
    if (!record(inspection) || typeof inspection.title !== 'string' ||
        typeof inspection.url !== 'string' || typeof inspection.text !== 'string' ||
        typeof inspection.readyState !== 'string' || !record(inspection.meta)) {
      throw new Error('Chrome DevTools MCP 页面检查结果无效')
    }
    const meta: Record<string, string> = {}
    for (const [key, value] of Object.entries(inspection.meta)) {
      if (typeof value === 'string') meta[key] = value
    }
    return {
      title: inspection.title,
      url: inspection.url,
      text: inspection.text,
      readyState: inspection.readyState,
      meta,
      outline: flattenSnapshot(snapshot).slice(0, 200).map((node) => ({
        role: node.role,
        name: node.name,
        tag: 'node',
        disabled: Boolean(node.disabled)
      }))
    }
  }

  async find(
    tabId: string,
    locator: BrowserLocator,
    context?: BrowserCallContext
  ): Promise<Array<Omit<BrowserElementResult, 'id' | 'tabId' | 'pageVersion'> & {
    backendNodeId: number
  }>> {
    if (locator.css || locator.tag) {
      throw new Error('Google 官方 MCP 的稳定快照不提供 CSS 或 DOM 标签到 UID 的映射')
    }
    const nodes = flattenSnapshot(await this.snapshot(tabId, context))
      .filter((node) => matchesLocator(node, locator))
      .slice(0, 100)
    return nodes.map((node) => {
      const backendNodeId = this.rememberElement(tabId, node.id)
      const label = `${node.role ?? ''} ${node.name ?? ''}`
      return {
        backendNodeId,
        role: node.role,
        name: node.name,
        tag: 'node',
        visible: true,
        disabled: Boolean(node.disabled),
        sensitive: isSensitiveElement(label),
        highRisk: isHighRiskElement(label)
      }
    })
  }

  async interact(
    tabId: string,
    backendNodeId: number,
    action: BrowserInteraction,
    context?: BrowserCallContext
  ): Promise<unknown> {
    const uid = this.element(tabId, backendNodeId)
    switch (action.type) {
      case 'click':
        return this.call('click', { pageId: pageId(tabId), uid }, context)
      case 'doubleClick':
        return this.call('click', { pageId: pageId(tabId), uid, dblClick: true }, context)
      case 'hover':
        return this.call('hover', { pageId: pageId(tabId), uid }, context)
      case 'type':
        return this.call('fill', { pageId: pageId(tabId), uid, value: action.text }, context)
      case 'select':
        return this.call('fill', { pageId: pageId(tabId), uid, value: action.value }, context)
      case 'check':
        return this.call('fill', {
          pageId: pageId(tabId),
          uid,
          value: action.checked ? 'true' : 'false'
        }, context)
      case 'key':
        return this.call('press_key', { pageId: pageId(tabId), key: action.key }, context)
      case 'scroll': {
        const x = finiteScroll(action.x ?? 0)
        const y = finiteScroll(action.y)
        return this.evaluate(tabId, `() => { window.scrollBy(${x}, ${y}); return true }`, context)
      }
    }
  }

  async drag(
    tabId: string,
    sourceBackendNodeId: number,
    targetBackendNodeId: number,
    context?: BrowserCallContext
  ): Promise<unknown> {
    return this.call('drag', {
      pageId: pageId(tabId),
      from_uid: this.element(tabId, sourceBackendNodeId),
      to_uid: this.element(tabId, targetBackendNodeId)
    }, context)
  }

  async screenshot(
    tabId: string,
    elementBackendNodeId?: number,
    context?: BrowserCallContext
  ): Promise<Buffer> {
    const result = await this.call('take_screenshot', {
      pageId: pageId(tabId),
      format: 'jpeg',
      quality: 70,
      ...(elementBackendNodeId === undefined
        ? {}
        : { uid: this.element(tabId, elementBackendNodeId) })
    }, context)
    const image = result.content.find((item) => item.type === 'image')
    if (!image || image.type !== 'image') {
      throw new Error('Chrome DevTools MCP 未以内联图片返回截图')
    }
    return Buffer.from(image.data, 'base64')
  }

  async diagnostics(tabId: string, context?: BrowserCallContext): Promise<BrowserDiagnostics> {
    const [consoleResult, networkResult, performance] = await Promise.all([
      this.call('list_console_messages', {
        pageId: pageId(tabId),
        pageSize: 100,
        types: ['error', 'assert', 'issue']
      }, context),
      this.call('list_network_requests', {
        pageId: pageId(tabId),
        pageSize: 100
      }, context),
      this.evaluate(tabId, PERFORMANCE_FUNCTION, context)
    ])
    const consoleMessages = structuredArray(consoleResult, 'consoleMessages')
    const networkRequests = structuredArray(networkResult, 'networkRequests')
    return {
      consoleErrors: consoleMessages.map(compactJson),
      failedRequests: networkRequests
        .filter((request) => isFailedRequest(request))
        .map(compactJson),
      performance: performanceSummary(performance)
    }
  }

  private async snapshot(
    tabId: string,
    context?: BrowserCallContext
  ): Promise<SnapshotNode> {
    const result = await this.call('take_snapshot', {
      pageId: pageId(tabId),
      verbose: false
    }, context)
    const structured = result.structuredContent
    if (!record(structured) || !snapshotNode(structured.snapshot)) {
      throw new Error('Chrome DevTools MCP 快照结构无效')
    }
    return structured.snapshot
  }

  private async evaluate(
    tabId: string,
    fn: string,
    context?: BrowserCallContext
  ): Promise<unknown> {
    const result = await this.call('evaluate_script', {
      pageId: pageId(tabId),
      function: fn
    }, context)
    const text = result.content.find((item) => item.type === 'text')
    if (!text || text.type !== 'text') throw new Error('Chrome DevTools MCP 脚本结果缺少文本')
    const match = /```json\s*([\s\S]*?)\s*```/.exec(text.text)
    if (!match?.[1]) throw new Error('Chrome DevTools MCP 脚本结果格式无效')
    try {
      return JSON.parse(match[1]) as unknown
    } catch {
      throw new Error('Chrome DevTools MCP 脚本结果不是 JSON')
    }
  }

  private async call(
    name: string,
    args: Record<string, unknown>,
    context?: BrowserCallContext
  ): Promise<ChromeDevtoolsMcpResult> {
    const result = await this.session.callTool(name, args, context?.signal)
    if (result.isError) throw officialToolError(name, result)
    if (record(result.structuredContent) && result.structuredContent.reconnected === true) {
      this.elements.clear()
      if (name !== 'list_pages') {
        throw new Error('Chrome 已重新连接，页面 ID 已变化，请重新获取标签页后再操作')
      }
    }
    return result
  }

  private rememberElement(tabId: string, uid: string): number {
    const id = this.nextElementId++
    this.elements.set(id, { tabId, uid })
    while (this.elements.size > MAX_ELEMENT_HANDLES) {
      const oldest = this.elements.keys().next().value
      if (oldest === undefined) break
      this.elements.delete(oldest)
    }
    return id
  }

  private element(tabId: string, id: number): string {
    const element = this.elements.get(id)
    if (!element || element.tabId !== tabId) throw new Error('Chrome 元素引用已失效')
    return element.uid
  }

  private clearTabElements(tabId: string): void {
    for (const [id, element] of this.elements) {
      if (element.tabId === tabId) this.elements.delete(id)
    }
  }
}

function pagesFrom(result: ChromeDevtoolsMcpResult): OfficialPage[] {
  const value = result.structuredContent
  if (!record(value) || !Array.isArray(value.pages)) {
    throw new Error('Chrome DevTools MCP 标签页结果无效')
  }
  return value.pages.map((page) => {
    if (!record(page) || !Number.isSafeInteger(page.id) || Number(page.id) < 0 ||
        typeof page.url !== 'string' || typeof page.title !== 'string' ||
        typeof page.selected !== 'boolean') {
      throw new Error('Chrome DevTools MCP 标签页字段无效')
    }
    return {
      id: Number(page.id),
      url: page.url,
      title: page.title,
      selected: page.selected
    }
  })
}

function pageId(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('Chrome 标签页 ID 无效')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error('Chrome 标签页 ID 无效')
  return parsed
}

function flattenSnapshot(root: SnapshotNode): SnapshotNode[] {
  const output: SnapshotNode[] = []
  const visit = (node: SnapshotNode): void => {
    output.push(node)
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  return output
}

function matchesLocator(node: SnapshotNode, locator: BrowserLocator): boolean {
  const role = node.role?.toLowerCase() ?? ''
  const name = node.name?.toLowerCase() ?? ''
  if (locator.role && role !== locator.role.trim().toLowerCase()) return false
  if (locator.text && !name.includes(locator.text.trim().toLowerCase())) return false
  return Boolean(locator.role || locator.text)
}

function snapshotNode(value: unknown): value is SnapshotNode {
  if (!record(value) || typeof value.id !== 'string') return false
  if (value.role !== undefined && typeof value.role !== 'string') return false
  if (value.name !== undefined && typeof value.name !== 'string') return false
  if (value.children !== undefined &&
      (!Array.isArray(value.children) || !value.children.every(snapshotNode))) return false
  return true
}

function structuredArray(result: ChromeDevtoolsMcpResult, key: string): unknown[] {
  const value = result.structuredContent
  if (!record(value) || !Array.isArray(value[key])) return []
  return value[key]
}

function compactJson(value: unknown): string {
  try { return JSON.stringify(value) } catch { return '[无法序列化]' }
}

function isFailedRequest(value: unknown): boolean {
  if (!record(value)) return false
  const status = typeof value.status === 'number'
    ? value.status
    : typeof value.statusCode === 'number' ? value.statusCode : 0
  return status >= 400 || value.failed === true || typeof value.failure === 'string'
}

function performanceSummary(value: unknown): BrowserDiagnostics['performance'] {
  if (!record(value)) return emptyPerformance()
  return {
    navigationMs: finiteMetric(value.navigationMs),
    domContentLoadedMs: finiteMetric(value.domContentLoadedMs),
    resourceCount: finiteMetric(value.resourceCount),
    transferBytes: finiteMetric(value.transferBytes)
  }
}

function emptyPerformance(): BrowserDiagnostics['performance'] {
  return { navigationMs: 0, domContentLoadedMs: 0, resourceCount: 0, transferBytes: 0 }
}

function finiteMetric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0
}

function finiteScroll(value: number): number {
  if (!Number.isFinite(value)) throw new Error('滚动距离无效')
  return Math.max(-100_000, Math.min(100_000, Math.round(value)))
}

function officialToolError(name: string, result: ChromeDevtoolsMcpResult): Error {
  const message = result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.type === 'text' ? item.text : '')
    .join('\n')
  if (/Could not connect to Chrome|DevToolsActivePort/i.test(message)) {
    return new Error(
      '无法连接 Chrome。请使用 Chrome 144+，在 chrome://inspect/#remote-debugging 开启远程调试，并在 Chrome 提示中允许连接'
    )
  }
  return new Error(`Chrome DevTools MCP 工具执行失败: ${name}`)
}

function isSensitiveElement(value: string): boolean {
  return /password|passwd|secret|token|api.?key|otp|验证码|信用卡|card number/i.test(value)
}

function isHighRiskElement(value: string): boolean {
  return /submit|purchase|buy|pay|delete|remove|confirm|发送|提交|购买|支付|删除|确认/i.test(value)
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
