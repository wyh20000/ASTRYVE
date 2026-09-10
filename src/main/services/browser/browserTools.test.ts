import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserTools } from './browserTools'

describe('browser tools', () => {
  afterEach(() => vi.useRealTimers())

  it('publish closed schemas and separate read from interaction operations', () => {
    const tools = createBrowserTools({} as never)
    expect(tools.length).toBeGreaterThanOrEqual(6)
    expect(tools.every((tool) => tool.parameters.additionalProperties === false)).toBe(true)
    expect(tools.every((tool) => !('action' in tool.parameters.properties))).toBe(true)
    expect(tools.find((tool) => tool.name === 'browser.inspect')?.operation).toBe('browser.read')
    expect(tools.find((tool) => tool.name === 'browser.click')?.operation).toBe('browser.interact')
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'browser.doubleClick', 'browser.hover', 'browser.scroll', 'browser.screenshotElement'
    ]))
    expect(tools.find((tool) => tool.name === 'browser.screenshotElement')?.operation).toBe('browser.read')
  })

  it('bounds every browser call so an unresponsive page cannot block the agent loop', async () => {
    vi.useFakeTimers()
    const tools = createBrowserTools({ listTabs: () => new Promise(() => undefined) } as never)
    const listTabs = tools.find((tool) => tool.name === 'browser.listTabs')!
    let result: Awaited<ReturnType<typeof listTabs.execute>> | undefined
    void listTabs.execute({}, { callId: 'browser-call', signal: new AbortController().signal } as never)
      .then((value) => { result = value })

    await vi.advanceTimersByTimeAsync(30_001)

    expect(result).toMatchObject({ ok: false, error: { code: 'BROWSER_OPERATION_FAILED', message: '浏览器操作已超时' } })
  })

  it('stops an in-flight browser call when the task is cancelled', async () => {
    vi.useFakeTimers()
    const tools = createBrowserTools({ listTabs: () => new Promise(() => undefined) } as never)
    const listTabs = tools.find((tool) => tool.name === 'browser.listTabs')!
    const controller = new AbortController()
    let result: Awaited<ReturnType<typeof listTabs.execute>> | undefined
    void listTabs.execute({}, { callId: 'browser-call', signal: controller.signal } as never)
      .then((value) => { result = value })

    controller.abort()
    await vi.advanceTimersByTimeAsync(1)

    expect(result).toMatchObject({ ok: false, error: { code: 'BROWSER_OPERATION_FAILED', message: '浏览器操作已取消' } })
  })

  it('rejects undeclared fields and values that do not match the closed tool schema', () => {
    const scroll = createBrowserTools({} as never).find((tool) => tool.name === 'browser.scroll')!
    const valid = { elementId: 'element-1', tabId: 'tab-1', pageVersion: 1, url: 'https://example.com', y: 200 }

    expect(scroll.validateArgs(valid)).toBe(true)
    expect(scroll.validateArgs({ ...valid, y: '200' })).toBe(false)
    expect(scroll.validateArgs({ ...valid, action: 'harmless-read' })).toBe(false)
  })
})
