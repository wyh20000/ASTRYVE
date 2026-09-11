import type { BrowserDiagnostics, BrowserElementResult, BrowserSemanticNode, BrowserTab } from '../../../shared/browser'
import type { BrowserAdapter, BrowserInteraction, BrowserLocator } from './browserGateway'

interface DevToolsTarget { id: string; title: string; url: string; type: string; webSocketDebuggerUrl?: string }
interface CdpMessage { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } }
const CDP_COMMAND_TIMEOUT_MS = 20_000
const CDP_CONNECT_TIMEOUT_MS = 10_000

export class ChromeCdpAdapter implements BrowserAdapter {
  private activeTabId?: string
  constructor(private readonly endpoint: () => string | undefined) {}

  async listTabs(): Promise<Array<Omit<BrowserTab, 'pageVersion'>>> {
    const targets = await this.targets()
    const pages = targets.filter((target) => target.type === 'page' && /^https?:|^about:/.test(target.url))
    if (!this.activeTabId || !pages.some((page) => page.id === this.activeTabId)) this.activeTabId = pages[0]?.id
    return pages.map((page) => ({ id: page.id, title: page.title, url: page.url, active: page.id === this.activeTabId }))
  }

  async createTab(url: string): Promise<string> {
    const endpoint = this.requireEndpoint()
    const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT', redirect: 'error' })
    if (!response.ok) throw new Error('无法新建 Chrome 标签页')
    const target = await response.json() as DevToolsTarget
    this.activeTabId = target.id
    // /json/new 建立的是后台标签页：立即激活并前置，用户才能看到窗口弹出并打开目标页面。
    // 前置失败不影响标签页创建结果。
    await this.activateTab(target.id).catch(() => undefined)
    return target.id
  }
  async activateTab(tabId: string): Promise<void> {
    const response = await fetch(`${this.requireEndpoint()}/json/activate/${encodeURIComponent(tabId)}`, { redirect: 'error' })
    if (!response.ok) throw new Error('无法切换 Chrome 标签页')
    this.activeTabId = tabId
    // /json/activate 只切换标签页，不保证浏览器窗口置顶；补一次 CDP bringToFront 让窗口真正前置。
    await this.bringToFront(tabId).catch(() => undefined)
  }
  /** 让标签页所属的浏览器窗口前置（尽力而为，失败不抛出）。 */
  async bringToFront(tabId: string): Promise<void> {
    await this.withClient(tabId, async (client) => { await client.send('Page.bringToFront') })
  }
  async closeTab(tabId: string): Promise<void> {
    const response = await fetch(`${this.requireEndpoint()}/json/close/${encodeURIComponent(tabId)}`, { redirect: 'error' })
    if (!response.ok) throw new Error('无法关闭 Chrome 标签页')
    if (this.activeTabId === tabId) this.activeTabId = undefined
  }
  async history(tabId: string, direction: 'back' | 'forward'): Promise<void> {
    await this.withClient(tabId, async (client) => {
      const history = await client.send('Page.getNavigationHistory') as { currentIndex: number; entries: Array<{ id: number }> }
      const index = history.currentIndex + (direction === 'back' ? -1 : 1)
      const entry = history.entries[index]
      if (!entry) throw new Error(direction === 'back' ? '没有可返回的页面' : '没有可前进的页面')
      await client.send('Page.navigateToHistoryEntry', { entryId: entry.id })
    })
  }
  async reload(tabId: string): Promise<void> { await this.withClient(tabId, async (client) => { await client.send('Page.reload', { ignoreCache: false }) }) }

  async navigate(tabId: string, url: string): Promise<void> {
    await this.withClient(tabId, async (client) => {
      await client.send('Page.enable')
      const loaded = client.waitFor('Page.loadEventFired', 15_000)
      await client.send('Page.navigate', { url })
      await loaded.catch(() => undefined)
    })
    this.activeTabId = tabId
    // 模型驱动浏览时把该标签页及其窗口前置，用户能直接看到页面。
    await this.activateTab(tabId).catch(() => undefined)
  }

  async inspect(tabId: string) {
    return this.withClient(tabId, async (client) => {
      const value = await evaluate(client, `(() => ({
        title: document.title,
        url: location.href,
        text: document.body?.innerText || '',
        readyState: document.readyState,
        meta: Object.fromEntries([...document.querySelectorAll('meta[name]')].slice(0,50).map(x => [x.getAttribute('name'), x.getAttribute('content') || ''])),
        outline: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,input,select,textarea,[role]')].slice(0,200).map(x => {
          const tag = x.tagName.toLowerCase();
          const labels = x.labels ? [...x.labels].map(label => label.innerText).join(' ') : '';
          const role = x.getAttribute('role') || (/^h[1-6]$/.test(tag) ? 'heading' : tag === 'a' ? 'link' : tag === 'button' ? 'button' : ['input','select','textarea'].includes(tag) ? 'textbox' : undefined);
          const name = x.getAttribute('aria-label') || labels || x.getAttribute('title') || x.getAttribute('placeholder') || (['input','select','textarea'].includes(tag) ? '' : x.innerText) || '';
          return { role, name, tag, disabled: Boolean(x.disabled || x.getAttribute('aria-disabled') === 'true') };
        })
      }))()`)
      return value as { title: string; url: string; text: string; readyState: string; meta: Record<string, string>; outline: BrowserSemanticNode[] }
    })
  }

  async find(tabId: string, locator: BrowserLocator) {
    const query = buildLocatorQuery(locator)
    return this.withClient(tabId, async (client) => {
      await client.send('DOM.enable')
      // Materialize the document in this CDP session before using search result
      // nodeIds. Without this, Chrome may return ids that describeNode cannot
      // resolve in a newly opened session.
      await client.send('DOM.getDocument', { depth: 0, pierce: true })
      const search = await client.send('DOM.performSearch', { query, includeUserAgentShadowDOM: true }) as { searchId: string; resultCount: number }
      const count = Math.min(search.resultCount, 100)
      if (!count) { await client.send('DOM.discardSearchResults', { searchId: search.searchId }); return [] }
      const result = await client.send('DOM.getSearchResults', { searchId: search.searchId, fromIndex: 0, toIndex: count }) as { nodeIds: number[] }
      const rows = await Promise.all(result.nodeIds.map(async (nodeId) => {
        const described = await client.send('DOM.describeNode', { nodeId, depth: 0 }) as { node: { backendNodeId: number; nodeName: string; attributes?: string[] } }
        const attrs = attributes(described.node.attributes ?? [])
        const resolved = await client.send('DOM.resolveNode', { nodeId }) as { object?: { objectId?: string } }
        const semantic = resolved.object?.objectId
          ? await client.send('Runtime.callFunctionOn', {
              objectId: resolved.object.objectId,
              functionDeclaration: `function(){
                const tag=(this.tagName||'').toLowerCase();
                const type=(this.getAttribute('type')||'').toLowerCase();
                const label=(this.getAttribute('aria-label')||this.getAttribute('title')||this.getAttribute('placeholder')||this.getAttribute('name')||this.id||this.innerText||'').trim().slice(0,300);
                const autocomplete=(this.getAttribute('autocomplete')||'').toLowerCase();
                const sensitive=type==='password'||/(?:current-password|new-password|one-time-code|cc-)/.test(autocomplete)||/(?:password|passwd|passcode|otp|验证码|信用卡|card.?number|cvv|cvc|api.?key|token|secret)/i.test(label);
                const highRisk=type==='submit'||/(?:send|publish|delete|remove|purchase|buy|pay|checkout|submit|confirm order|发送|发布|删除|购买|支付|提交|下单)/i.test(label);
                return {label,sensitive,highRisk,role:this.getAttribute('role')||undefined};
              }`,
              returnByValue: true
            }) as { result?: { value?: { label?: string; sensitive?: boolean; highRisk?: boolean; role?: string } } }
          : undefined
        const semantics = semantic?.result?.value
        const box = await client.send('DOM.getBoxModel', { nodeId }).catch(() => undefined) as { model?: { border?: number[] } } | undefined
        const bounds = quadBounds(box?.model?.border)
        return { backendNodeId: described.node.backendNodeId, role: semantics?.role || attrs.role, name: semantics?.label || attrs['aria-label'] || attrs.name || attrs.title,
          tag: described.node.nodeName.toLowerCase(), visible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
          disabled: 'disabled' in attrs || attrs['aria-disabled'] === 'true', sensitive: Boolean(semantics?.sensitive),
          highRisk: Boolean(semantics?.highRisk), bounds }
      }))
      await client.send('DOM.discardSearchResults', { searchId: search.searchId })
      return rows
    })
  }

  async interact(tabId: string, backendNodeId: number, action: BrowserInteraction): Promise<unknown> {
    return this.withClient(tabId, async (client) => {
      if (action.type === 'scroll') return client.send('Runtime.evaluate', { expression: `window.scrollBy(${Number(action.x ?? 0)},${Number(action.y)})` })
      const resolved = await client.send('DOM.resolveNode', { backendNodeId }) as { object: { objectId?: string } }
      const objectId = resolved.object.objectId
      if (!objectId) throw new Error('元素已不存在')
      if (action.type === 'key') {
        await client.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){this.focus()}' })
        return client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: action.key })
      }
      const expression = interactionFunction(action)
      return client.send('Runtime.callFunctionOn', { objectId, functionDeclaration: expression, returnByValue: true })
    })
  }

  async drag(tabId: string, sourceBackendNodeId: number, targetBackendNodeId: number): Promise<unknown> {
    return this.withClient(tabId, async (client) => {
      const source = await elementCenter(client, sourceBackendNodeId)
      const target = await elementCenter(client, targetBackendNodeId)
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...source })
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...source })
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target })
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...target })
      return { ok: true }
    })
  }

  async screenshot(tabId: string, backendNodeId?: number): Promise<Buffer> {
    return this.withClient(tabId, async (client) => {
      await client.send('Page.enable')
      let clip: Record<string, number> | undefined
      if (backendNodeId !== undefined) {
        const box = await client.send('DOM.getBoxModel', { backendNodeId }) as { model: { border: number[] } }
        const bounds = quadBounds(box.model.border)
        if (bounds) clip = { ...bounds, scale: 1 }
      }
      const result = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, ...(clip ? { clip } : {}) }) as { data: string }
      return Buffer.from(result.data, 'base64')
    })
  }

  async diagnostics(tabId: string): Promise<BrowserDiagnostics> {
    return this.withClient(tabId, async (client) => {
      const consoleErrors: string[] = []
      const failedRequests: string[] = []
      const disposers = [
        client.on('Log.entryAdded', (params) => {
          const entry = (params as { entry?: { level?: string; text?: string } }).entry
          if (entry?.text && (entry.level === 'error' || entry.level === 'warning')) consoleErrors.push(entry.text)
        }),
        client.on('Runtime.exceptionThrown', (params) => {
          const details = (params as { exceptionDetails?: { text?: string } }).exceptionDetails
          if (details?.text) consoleErrors.push(details.text)
        }),
        client.on('Network.loadingFailed', (params) => {
          const failure = params as { errorText?: string; type?: string; blockedReason?: string }
          failedRequests.push([failure.type, failure.errorText, failure.blockedReason].filter(Boolean).join(' · '))
        })
      ]
      try {
        await Promise.all([client.send('Log.enable'), client.send('Runtime.enable'), client.send('Network.enable')])
        await new Promise((resolve) => setTimeout(resolve, 250))
        const performance = await evaluate(client, `(() => {
          const navigation = performance.getEntriesByType('navigation')[0];
          const resources = performance.getEntriesByType('resource');
          return {
            navigationMs: navigation?.duration || 0,
            domContentLoadedMs: navigation?.domContentLoadedEventEnd || 0,
            resourceCount: resources.length,
            transferBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0)
          };
        })()`) as BrowserDiagnostics['performance']
        return { consoleErrors, failedRequests, performance }
      } finally { for (const dispose of disposers) dispose() }
    })
  }

  private async targets(): Promise<DevToolsTarget[]> {
    const endpoint = this.requireEndpoint()
    const response = await fetch(`${endpoint}/json/list`, { redirect: 'error' })
    if (!response.ok) throw new Error('无法读取 Chrome 标签页')
    return await response.json() as DevToolsTarget[]
  }
  private requireEndpoint(): string { const value = this.endpoint(); if (!value) throw new Error('独立 Chrome 尚未启动'); return value }
  private async withClient<T>(tabId: string, action: (client: CdpClient) => Promise<T>): Promise<T> {
    const target = (await this.targets()).find((item) => item.id === tabId && item.webSocketDebuggerUrl)
    if (!target?.webSocketDebuggerUrl) throw new Error('浏览器标签页不存在')
    const client = await CdpClient.connect(target.webSocketDebuggerUrl)
    try { return await action(client) } finally { client.close() }
  }
}

export function buildLocatorQuery(locator: BrowserLocator): string {
  if (locator.css?.trim()) return locator.css.trim().slice(0, 1000)
  if (locator.role?.trim()) {
    const role = locator.role.trim()
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,50}$/.test(role)) throw new Error('角色定位条件无效')
    return `[role="${role}"]`
  }
  if (locator.tag?.trim()) {
    const tag = locator.tag.trim().toLowerCase()
    if (!/^[a-z][a-z0-9-]{0,50}$/.test(tag)) throw new Error('标签定位条件无效')
    return tag
  }
  if (locator.text?.trim()) return locator.text.trim().slice(0, 500)
  throw new Error('元素定位条件无效')
}

class CdpClient {
  private sequence = 0
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly events = new Map<string, Array<(params: unknown) => void>>()
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => this.receive(String(event.data)))
    socket.addEventListener('close', () => this.failAll(new Error('Chrome 调试连接已关闭')))
  }
  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      const cleanup = (): void => {
        clearTimeout(timer)
        socket.removeEventListener('open', opened)
        socket.removeEventListener('error', failed)
      }
      const opened = (): void => { cleanup(); resolve(new CdpClient(socket)) }
      const failed = (): void => { cleanup(); reject(new Error('无法连接 Chrome 调试端口')) }
      const timer = setTimeout(() => {
        cleanup()
        socket.close()
        reject(new Error('Chrome 调试连接超时'))
      }, CDP_CONNECT_TIMEOUT_MS)
      socket.addEventListener('open', opened, { once: true })
      socket.addEventListener('error', failed, { once: true })
    })
  }
  send(method: string, params: unknown = {}): Promise<unknown> {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return
        reject(new Error(`Chrome 调试命令超时：${method}`))
      }, CDP_COMMAND_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) }
      })
      try { this.socket.send(JSON.stringify({ id, method, params })) }
      catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  }
  waitFor(method: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const listeners = this.events.get(method) ?? []
      const remove = (): void => {
        const current = this.events.get(method) ?? []
        const next = current.filter((item) => item !== listener)
        if (next.length) this.events.set(method, next); else this.events.delete(method)
      }
      const timer = setTimeout(() => { remove(); reject(new Error('等待页面稳定超时')) }, timeoutMs)
      const listener = (params: unknown): void => { clearTimeout(timer); remove(); resolve(params) }
      listeners.push(listener); this.events.set(method, listeners)
    })
  }
  on(method: string, listener: (params: unknown) => void): () => void {
    const listeners = this.events.get(method) ?? []
    listeners.push(listener)
    this.events.set(method, listeners)
    return () => {
      const next = (this.events.get(method) ?? []).filter((item) => item !== listener)
      if (next.length) this.events.set(method, next); else this.events.delete(method)
    }
  }
  close(): void { this.socket.close() }
  private receive(raw: string): void {
    let message: CdpMessage
    try { message = JSON.parse(raw) as CdpMessage } catch { return }
    if (message.id) {
      const pending = this.pending.get(message.id); this.pending.delete(message.id)
      if (message.error) pending?.reject(new Error(message.error.message || 'Chrome 操作失败')); else pending?.resolve(message.result)
    } else if (message.method) for (const listener of this.events.get(message.method) ?? []) listener(message.params)
  }
  private failAll(error: Error): void { for (const item of this.pending.values()) item.reject(error); this.pending.clear() }
}

async function evaluate(client: CdpClient, expression: string): Promise<unknown> {
  const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }) as { result?: { value?: unknown }; exceptionDetails?: unknown }
  if (result.exceptionDetails) throw new Error('网页脚本执行失败')
  return result.result?.value
}
function attributes(values: string[]): Record<string, string> { const result: Record<string, string> = {}; for (let i = 0; i < values.length; i += 2) result[values[i]] = values[i + 1] ?? ''; return result }
function quadBounds(quad?: number[]): BrowserElementResult['bounds'] {
  if (!quad || quad.length < 8) return undefined
  const xs = [quad[0], quad[2], quad[4], quad[6]], ys = [quad[1], quad[3], quad[5], quad[7]]
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
async function elementCenter(client: CdpClient, backendNodeId: number): Promise<{ x: number; y: number }> {
  const box = await client.send('DOM.getBoxModel', { backendNodeId }) as { model?: { border?: number[] } }
  const bounds = quadBounds(box.model?.border)
  if (!bounds) throw new Error('元素当前不可见')
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}
function interactionFunction(action: BrowserInteraction): string {
  if (action.type === 'click') return 'function(){this.click();return {ok:true}}'
  if (action.type === 'doubleClick') return 'function(){this.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));return {ok:true}}'
  if (action.type === 'hover') return 'function(){this.dispatchEvent(new MouseEvent("mouseover",{bubbles:true}));return {ok:true}}'
  if (action.type === 'type') return `function(){this.focus();${action.clear ? 'this.value="";' : ''}this.value+=${JSON.stringify(action.text)};this.dispatchEvent(new Event("input",{bubbles:true}));this.dispatchEvent(new Event("change",{bubbles:true}));return {ok:true}}`
  if (action.type === 'select') return `function(){this.value=${JSON.stringify(action.value)};this.dispatchEvent(new Event("change",{bubbles:true}));return {ok:true}}`
  if (action.type === 'check') return `function(){this.checked=${action.checked};this.dispatchEvent(new Event("change",{bubbles:true}));return {ok:true}}`
  return 'function(){return {ok:false}}'
}
