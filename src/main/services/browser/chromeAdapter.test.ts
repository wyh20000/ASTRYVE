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
