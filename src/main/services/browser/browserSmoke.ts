import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserGateway } from './browserGateway'
import { ChromeCdpAdapter } from './chromeAdapter'
import { ChromeProcessManager } from './chromeProcess'

export async function runManagedBrowserSmoke(): Promise<void> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'ai-agent-browser-smoke-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Browser smoke</title><button id="run" onclick="document.body.dataset.clicked=\'yes\'">Run smoke</button><input id="password" type="password"><button id="delete" onclick="document.body.dataset.deleted=\'yes\'">Delete account</button><p>managed chrome ready</p>')
  })
  const chrome = new ChromeProcessManager(dataRoot)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Local smoke server did not start')
    const url = `http://127.0.0.1:${address.port}/`
    const started = await step('start', () => chrome.start())
    if (!started.running || !started.endpoint) throw new Error(started.reason ?? 'Managed Chrome did not start')
    const gateway = new BrowserGateway(new ChromeCdpAdapter(() => chrome.getEndpoint()))
    const tabId = await step('open-tab', () => gateway.createTab(url))
    const page = await step('wait-for-page', () => gateway.waitForPage(tabId, url, 10_000, {
      callId: 'browser-smoke-wait', source: 'smoke', risk: 'low', deadline: Date.now() + 10_000
    }))
    if (page.title !== 'Browser smoke' || !page.text.includes('managed chrome ready')) {
      throw new Error('Managed Chrome page inspection failed')
    }
    const [button] = await step('find', () => gateway.find(tabId, { css: '#run' }))
    if (!button) throw new Error('Managed Chrome element lookup failed')
    await step('interact', () => gateway.interact(button, { type: 'click' }, {
      callId: 'browser-smoke-click', source: 'smoke', risk: 'medium', deadline: Date.now() + 10_000
    }))
    const [password] = await step('find-sensitive', () => gateway.find(tabId, { css: '#password' }))
    if (!password?.sensitive) throw new Error('Sensitive field classification failed')
    await expectBlocked('sensitive input', () => gateway.interact(password, { type: 'type', text: 'ordinary-value' }, {
      callId: 'browser-smoke-sensitive', source: 'smoke', risk: 'medium', deadline: Date.now() + 10_000
    }))
    const [deleteButton] = await step('find-high-risk', () => gateway.find(tabId, { css: '#delete' }))
    if (!deleteButton?.highRisk) throw new Error('High-risk action classification failed')
    await expectBlocked('unconfirmed high-risk click', () => gateway.interact(deleteButton, { type: 'click' }, {
      callId: 'browser-smoke-unconfirmed', source: 'smoke', risk: 'medium', deadline: Date.now() + 10_000
    }))
    await step('confirmed-high-risk-click', () => gateway.interact(deleteButton, { type: 'click' }, {
      callId: 'browser-smoke-confirmed', source: 'smoke', risk: 'high', deadline: Date.now() + 10_000
    }))
    const screenshot = await step('screenshot', () => gateway.screenshot(tabId))
    if (screenshot.byteLength < 100) throw new Error('Managed Chrome screenshot was empty')
  } finally {
    chrome.stop()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(dataRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  try { return await action() }
  catch (error) { throw new Error(`Managed Chrome ${name} failed`, { cause: error }) }
}

async function expectBlocked(name: string, action: () => Promise<unknown>): Promise<void> {
  try { await action() } catch { return }
  throw new Error(`Managed Chrome ${name} was not blocked`)
}
