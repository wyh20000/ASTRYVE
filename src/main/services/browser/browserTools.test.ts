import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeBrowserScreenshotArtifact, createBrowserTools } from './browserTools'

describe('browser tools', () => {
  afterEach(() => vi.useRealTimers())

  it('publish closed schemas and separate read from interaction operations', () => {
    const tools = createBrowserTools({} as never)
    expect(tools.length).toBeGreaterThanOrEqual(6)
    expect(tools.every((tool) => tool.parameters.additionalProperties === false)).toBe(true)
    expect(tools.every((tool) => !('action' in tool.parameters.properties))).toBe(true)
    expect(tools.find((tool) => tool.name === 'browser.inspect')?.operation).toBe('browser.read')
    expect(tools.find((tool) => tool.name === 'browser.click')?.operation).toBe('browser.interact')
    expect(tools.find((tool) => tool.name === 'browser.scroll')?.operation).toBe('browser.read')
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'browser.doubleClick', 'browser.hover', 'browser.scroll', 'browser.screenshotElement', 'browser.waitForPage', 'browser.confirmClick'
    ]))
    expect(tools.find((tool) => tool.name === 'browser.screenshotElement')?.operation).toBe('browser.read')
  })

  it('uses a trusted high-risk context for confirmed consequential clicks', async () => {
    const assertTabOrigin = vi.fn(async () => undefined)
    const interact = vi.fn(async () => ({ ok: true }))
    const confirmClick = createBrowserTools({ assertTabOrigin, interact } as never)
      .find((tool) => tool.name === 'browser.confirmClick')!

    await confirmClick.execute({
      elementId: 'element-1', tabId: 'tab-1', pageVersion: 1, url: 'https://example.com/delete'
    }, { callId: 'confirmed-call', signal: new AbortController().signal } as never)

    expect(interact).toHaveBeenCalledWith(expect.anything(), { type: 'click' }, expect.objectContaining({
      callId: 'confirmed-call', risk: 'high', source: 'agent'
    }))
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

  it('passes trusted call context to both read and navigation gateway calls', async () => {
    const listTabs = vi.fn(async () => [])
    const navigate = vi.fn(async () => undefined)
    const tools = createBrowserTools({ listTabs, navigate } as never)
    const controller = new AbortController()
    const context = { callId: 'browser-context-call', signal: controller.signal } as never

    await tools.find((tool) => tool.name === 'browser.listTabs')!.execute({}, context)
    await tools.find((tool) => tool.name === 'browser.navigate')!.execute({
      tabId: 'tab-1', url: 'https://example.com'
    }, context)

    expect(listTabs).toHaveBeenCalledWith(expect.objectContaining({
      callId: 'browser-context-call', source: 'agent', risk: 'low', signal: controller.signal
    }))
    expect(navigate).toHaveBeenCalledWith('tab-1', 'https://example.com', expect.objectContaining({
      callId: 'browser-context-call', source: 'agent', risk: 'medium', signal: controller.signal
    }))
  })

  it('rejects undeclared fields and values that do not match the closed tool schema', () => {
    const scroll = createBrowserTools({} as never).find((tool) => tool.name === 'browser.scroll')!
    const valid = { elementId: 'element-1', tabId: 'tab-1', pageVersion: 1, url: 'https://example.com', y: 200 }

    expect(scroll.validateArgs(valid)).toBe(true)
    expect(scroll.validateArgs({ ...valid, y: '200' })).toBe(false)
    expect(scroll.validateArgs({ ...valid, action: 'harmless-read' })).toBe(false)
  })

  it('returns compact screenshot metadata and transfers image bytes through the host artifact channel', async () => {
    const screenshot = createBrowserTools({
      assertTabOrigin: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => Buffer.from('jpeg-bytes'))
    } as never).find((tool) => tool.name === 'browser.screenshot')!
    const context = {
      taskId: 'task-browser', callId: 'shot-call', signal: new AbortController().signal
    } as never

    const result = await screenshot.execute({
      tabId: 'tab-1', url: 'https://example.com'
    }, context)

    expect(result).toMatchObject({
      ok: true,
      value: { mimeType: 'image/jpeg', byteLength: 10, persistedByHost: true }
    })
    expect(JSON.stringify(result)).not.toContain('anBlZy1ieXRlcw')
    if (!result.ok) throw new Error('expected screenshot success')
    expect(consumeBrowserScreenshotArtifact(result.value, 'task-browser', 'shot-call'))
      .toMatchObject({ mimeType: 'image/jpeg', data: Buffer.from('jpeg-bytes').toString('base64') })
    expect(consumeBrowserScreenshotArtifact(result.value, 'task-browser', 'shot-call')).toBeUndefined()
  })
})
