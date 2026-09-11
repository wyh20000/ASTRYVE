import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLocatorQuery, ChromeCdpAdapter } from './chromeAdapter'

describe('Chrome locator query', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('prefers CSS and safely escapes role, tag and text locators', () => {
    expect(buildLocatorQuery({ css: '#submit' })).toBe('#submit')
    expect(buildLocatorQuery({ role: 'button' })).toBe('[role="button"]')
    expect(buildLocatorQuery({ tag: 'input' })).toBe('input')
    expect(buildLocatorQuery({ text: 'Save changes' })).toBe('Save changes')
  })

  it('rejects empty and malformed locators', () => {
    expect(() => buildLocatorQuery({})).toThrow('无效')
    expect(() => buildLocatorQuery({ role: 'a"]' })).toThrow('无效')
  })

  it('times out an unanswered CDP command so the socket can be closed', async () => {
    vi.useFakeTimers()
    class SilentSocket extends EventTarget {
      send = vi.fn()
      close = vi.fn()
      constructor() {
        super()
        queueMicrotask(() => this.dispatchEvent(new Event('open')))
      }
    }
    vi.stubGlobal('WebSocket', SilentSocket)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      id: 'tab-1', title: 'Example', url: 'https://example.com', type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/1'
    }]), { status: 200 })))
    const adapter = new ChromeCdpAdapter(() => 'http://127.0.0.1:9222')
    let failure: Error | undefined
    void adapter.inspect('tab-1').catch((error) => { failure = error })

    await vi.advanceTimersByTimeAsync(20_001)

    expect(failure?.message).toContain('超时')
  })

  it('times out a CDP socket that never completes its opening handshake', async () => {
    vi.useFakeTimers()
    class NeverOpenSocket extends EventTarget {
      send = vi.fn()
      close = vi.fn()
    }
    vi.stubGlobal('WebSocket', NeverOpenSocket)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      id: 'tab-1', title: 'Example', url: 'https://example.com', type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/1'
    }]), { status: 200 })))
    const adapter = new ChromeCdpAdapter(() => 'http://127.0.0.1:9222')
    let failure: Error | undefined
    void adapter.inspect('tab-1').catch((error) => { failure = error })

    await vi.advanceTimersByTimeAsync(10_001)

    expect(failure?.message).toContain('连接超时')
  })
})

describe('Chrome tab foregrounding', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('activates and brings a newly created tab to the front', async () => {
    const calls: Array<{ method: string; url: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      calls.push({ method: init?.method ?? 'GET', url })
      if (url.includes('/json/new')) {
        return new Response(JSON.stringify({
          id: 'tab-9', title: '', url: '', type: 'page',
          webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/9'
        }), { status: 200 })
      }
      if (url.includes('/json/activate/')) return new Response('{}', { status: 200 })
      if (url.includes('/json/list')) {
        return new Response(JSON.stringify([{
          id: 'tab-9', title: 'Example', url: 'https://example.com', type: 'page',
          webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/9'
        }]), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }))

    const sent: string[] = []
    class EchoSocket extends EventTarget {
      send = (data: string): void => {
        sent.push(data)
        const parsed = JSON.parse(data) as { id: number }
        queueMicrotask(() => this.dispatchEvent(
          Object.assign(new Event('message'), { data: JSON.stringify({ id: parsed.id, result: {} }) })
        ))
      }
      close = vi.fn()
      constructor() {
        super()
        queueMicrotask(() => this.dispatchEvent(new Event('open')))
      }
    }
    vi.stubGlobal('WebSocket', EchoSocket)

    const adapter = new ChromeCdpAdapter(() => 'http://127.0.0.1:9222')
    await expect(adapter.createTab('https://example.com')).resolves.toBe('tab-9')

    expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/json/new'))).toBe(true)
    expect(calls.some((call) => call.url.includes('/json/activate/tab-9'))).toBe(true)
    expect(sent.some((message) => message.includes('Page.bringToFront'))).toBe(true)
  })
})
