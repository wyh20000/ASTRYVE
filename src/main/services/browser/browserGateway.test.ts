import { describe, expect, it, vi } from 'vitest'
import { BrowserGateway, type BrowserAdapter } from './browserGateway'

function adapter(): BrowserAdapter {
  return {
    listTabs: vi.fn(async () => [{ id: 'tab-1', title: 'Example', url: 'https://example.com', active: true }]),
    createTab: vi.fn(async () => 'tab-2'), activateTab: vi.fn(async () => undefined), closeTab: vi.fn(async () => undefined),
    history: vi.fn(async () => undefined), reload: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    pageState: vi.fn(async () => ({
      title: 'Example', url: 'https://example.com', readyState: 'complete'
    })),
    inspect: vi.fn(async () => ({
      title: 'Example', url: 'https://example.com', text: 'password=secret token abc',
      readyState: 'complete',
      meta: { description: 'safe summary', authorization: 'Bearer secret' },
      outline: [{ role: 'heading', name: 'Account', tag: 'h1', disabled: false }, { role: 'textbox', name: 'API token secret', tag: 'input', disabled: false }]
    })),
    find: vi.fn(async () => [{ backendNodeId: 42, role: 'button', name: 'Submit', visible: true, disabled: false }]),
    interact: vi.fn(async () => ({ ok: true })), drag: vi.fn(async () => ({ ok: true })), screenshot: vi.fn(async () => Buffer.from('png')),
    diagnostics: vi.fn(async () => ({
      consoleErrors: ['Bearer secret'], failedRequests: [],
      performance: { navigationMs: 120, domContentLoadedMs: 80, resourceCount: 4, transferBytes: 2048 }
    }))
  }
}

describe('BrowserGateway', () => {
  it('removes credentials, query parameters and fragments from model-visible URLs', async () => {
    const fake = adapter()
    fake.listTabs = vi.fn(async () => [{
      id: 'tab-secret',
      title: 'Signed in',
      url: 'https://user:password@example.com/account?token=secret#private',
      active: true
    }])
    fake.inspect = vi.fn(async () => ({
      title: 'Signed in',
      url: 'https://example.com/account?token=secret#private',
      text: '',
      readyState: 'complete',
      meta: {},
      outline: []
    }))
    const gateway = new BrowserGateway(fake)

    expect((await gateway.listTabs())[0].url).toBe('https://example.com/account')
    expect((await gateway.inspect('tab-secret')).url).toBe('https://example.com/account')
  })

  it('versions pages and rejects stale element references after navigation', async () => {
    const gateway = new BrowserGateway(adapter())
    await gateway.listTabs()
    const [element] = await gateway.find('tab-1', { role: 'button' })
    await gateway.navigate('tab-1', 'https://example.com/next')
    await expect(gateway.interact(element, { type: 'click' }, context('write'))).rejects.toThrow('过期')
  })

  it('serializes writes to the same tab while allowing bounded results', async () => {
    let active = 0; let max = 0
    const fake = adapter()
    fake.interact = vi.fn(async () => { active += 1; max = Math.max(max, active); await Promise.resolve(); active -= 1; return { ok: true } })
    const gateway = new BrowserGateway(fake)
    await gateway.listTabs()
    const [element] = await gateway.find('tab-1', { role: 'button' })
    await Promise.all([gateway.interact(element, { type: 'click' }, context('a')), gateway.interact(element, { type: 'click' }, context('b'))])
    expect(max).toBe(1)
  })

  it('keeps a cancelled write in the queue until the adapter operation settles', async () => {
    let active = 0
    let max = 0
    let calls = 0
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
    const fake = adapter()
    fake.interact = vi.fn(async () => {
      calls += 1
      active += 1
      max = Math.max(max, active)
      if (calls === 1) {
        markFirstStarted()
        await firstGate
      }
      active -= 1
      return { ok: true }
    })
    const gateway = new BrowserGateway(fake)
    const [element] = await gateway.find('tab-1', { role: 'button' })
    const controller = new AbortController()

    const first = gateway.interact(element, { type: 'click' }, {
      ...context('cancelled-write'), signal: controller.signal
    })
    await firstStarted
    controller.abort()
    await expect(first).rejects.toThrow('取消')

    const second = gateway.interact(element, { type: 'click' }, context('following-write'))
    await Promise.resolve()
    expect(fake.interact).toHaveBeenCalledTimes(1)
    releaseFirst()
    await second
    expect(max).toBe(1)
  })

  it('limits concurrent page reads across browser tools', async () => {
    let active = 0
    let max = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fake = adapter()
    fake.inspect = async () => {
      active += 1
      max = Math.max(max, active)
      await gate
      active -= 1
      return { title: 'Example', url: 'https://example.com', text: '', readyState: 'complete', meta: {}, outline: [] }
    }
    const gateway = new BrowserGateway(fake, { maxConcurrentReads: 2 })

    const reads = [gateway.inspect('tab-1'), gateway.inspect('tab-1'), gateway.inspect('tab-1')]
    await Promise.resolve()
    await Promise.resolve()
    expect(max).toBe(2)
    release()
    await Promise.all(reads)
  })

  it('removes a cancelled read while it is waiting for a permit', async () => {
    let releaseFirst!: () => void
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const fake = adapter()
    fake.inspect = vi.fn(async () => {
      await gate
      return { title: 'Example', url: 'https://example.com', text: '', readyState: 'complete', meta: {}, outline: [] }
    })
    const gateway = new BrowserGateway(fake, { maxConcurrentReads: 1 })
    const first = gateway.inspect('tab-1')
    await Promise.resolve()
    const controller = new AbortController()
    const second = gateway.inspect('tab-1', { ...context('queued-read'), signal: controller.signal })

    controller.abort()
    await expect(second).rejects.toThrow('取消')
    expect(fake.inspect).toHaveBeenCalledTimes(1)
    releaseFirst()
    await first
  })

  it('releases a read permit when an adapter throws synchronously', async () => {
    const fake = adapter()
    let calls = 0
    fake.inspect = vi.fn(() => {
      calls += 1
      if (calls === 1) throw new Error('sync failure')
      return Promise.resolve({ title: 'Example', url: 'https://example.com', text: '', readyState: 'complete', meta: {}, outline: [] })
    })
    const gateway = new BrowserGateway(fake, { maxConcurrentReads: 1 })

    await expect(gateway.inspect('tab-1')).rejects.toThrow('sync failure')
    const second = gateway.inspect('tab-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(fake.inspect).toHaveBeenCalledTimes(2)
    await second
  })

  it('serializes navigation with interactions and rejects the stale queued element', async () => {
    let releaseNavigation!: () => void
    let markNavigationStarted!: () => void
    const navigationGate = new Promise<void>((resolve) => { releaseNavigation = resolve })
    const navigationStarted = new Promise<void>((resolve) => { markNavigationStarted = resolve })
    const fake = adapter()
    fake.navigate = vi.fn(async () => { markNavigationStarted(); await navigationGate })
    const gateway = new BrowserGateway(fake)
    const [element] = await gateway.find('tab-1', { role: 'button' })

    const navigation = gateway.navigate('tab-1', 'https://example.com/next', context('navigate'))
    await navigationStarted
    const interaction = gateway.interact(element, { type: 'click' }, context('after-navigation'))
    await Promise.resolve()
    expect(fake.interact).not.toHaveBeenCalled()
    releaseNavigation()
    await navigation
    await expect(interaction).rejects.toThrow('过期')
    expect(fake.interact).not.toHaveBeenCalled()
  })

  it('redacts sensitive values and limits page text', async () => {
    const gateway = new BrowserGateway(adapter(), { maxText: 20 })
    await gateway.listTabs()
    const result = await gateway.inspect('tab-1')
    expect(result.text).not.toContain('secret')
    expect(result.text.length).toBeLessThanOrEqual(20)
    expect(result.textTruncated).toBe(true)
  })

  it('redacts passwords, verification codes, cookies and payment numbers from page text', async () => {
    const fake = adapter()
    fake.inspect = vi.fn(async () => ({
      title: 'Checkout', url: 'https://example.com/pay', readyState: 'complete', meta: {}, outline: [],
      text: 'password=hunter2 验证码: 123456 cookie=session-value card number 4111 1111 1111 1111'
    }))
    const result = await new BrowserGateway(fake, { maxText: 1_000 }).inspect('tab-1')

    expect(result.text).not.toContain('hunter2')
    expect(result.text).not.toContain('123456')
    expect(result.text).not.toContain('session-value')
    expect(result.text).not.toContain('4111')
    expect(result.text.match(/\[已脱敏\]/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('returns bounded redacted page metadata instead of dropping it', async () => {
    const gateway = new BrowserGateway(adapter())
    const result = await gateway.inspect('tab-1')
    expect(result.meta).toEqual({ description: 'safe summary', authorization: '[已脱敏]' })
  })

  it('returns a bounded semantic outline with sensitive names redacted', async () => {
    const gateway = new BrowserGateway(adapter())
    const result = await gateway.inspect('tab-1')
    expect(result.outline).toEqual([
      { role: 'heading', name: 'Account', tag: 'h1', disabled: false },
      { role: 'textbox', name: '[已脱敏]', tag: 'input', disabled: false }
    ])
  })

  it('returns bounded diagnostics with a numeric performance summary', async () => {
    const gateway = new BrowserGateway(adapter())
    await expect(gateway.diagnostics('tab-1')).resolves.toMatchObject({
      performance: { navigationMs: 120, domContentLoadedMs: 80, resourceCount: 4, transferBytes: 2048 }
    })
  })

  it('bounds long console and failed-request streams to their newest sanitized entries', async () => {
    const fake = adapter()
    fake.diagnostics = vi.fn(async () => ({
      consoleErrors: Array.from({ length: 250 }, (_, index) => `error-${index}-${'x'.repeat(2_000)}`),
      failedRequests: Array.from({ length: 250 }, (_, index) => `https://example.com/fail-${index}`),
      performance: { navigationMs: 1, domContentLoadedMs: 1, resourceCount: 250, transferBytes: 1_000_000 }
    }))
    const result = await new BrowserGateway(fake).diagnostics('tab-1')

    expect(result.consoleErrors).toHaveLength(100)
    expect(result.failedRequests).toHaveLength(100)
    expect(result.consoleErrors[0]).toContain('error-150')
    expect(result.consoleErrors.every((value) => value.length <= 1_000)).toBe(true)
  })

  it('bounds a large page inspection and does not retain repeated screenshots', async () => {
    const fake = adapter()
    fake.inspect = vi.fn(async () => ({
      title: 'Large page', url: 'https://example.com/large', readyState: 'complete', meta: {},
      text: 'x'.repeat(500_000),
      outline: Array.from({ length: 1_000 }, (_, index) => ({ role: 'row', name: `Row ${index}`, tag: 'div', disabled: false }))
    }))
    fake.screenshot = vi.fn(async () => Buffer.alloc(1_024, 1))
    const gateway = new BrowserGateway(fake)

    const inspection = await gateway.inspect('tab-1')
    expect(inspection.text).toHaveLength(64_000)
    expect(inspection.textTruncated).toBe(true)
    expect(inspection.outline).toHaveLength(200)
    expect(inspection.outlineTruncated).toBe(true)
    for (let index = 0; index < 100; index += 1) {
      await expect(gateway.screenshot('tab-1')).resolves.toHaveLength(1_024)
    }
    expect(fake.screenshot).toHaveBeenCalledTimes(100)
  })

  it('blocks navigation denied by site policy', async () => {
    const gateway = new BrowserGateway(adapter(), { canNavigate: (url) => url.hostname !== 'blocked.test' })
    await expect(gateway.createTab('https://blocked.test')).rejects.toThrow('阻止')
  })

  it('reuses an already open identical URL instead of creating duplicate tabs', async () => {
    const fake = adapter()
    const gateway = new BrowserGateway(fake)

    await expect(gateway.createTab('https://example.com')).resolves.toEqual({
      tabId: 'tab-1', reused: true
    })
    expect(fake.createTab).not.toHaveBeenCalled()
  })

  it('binds reads and writes to the tab origin reported by Chrome', async () => {
    const gateway = new BrowserGateway(adapter())
    await expect(gateway.assertTabOrigin('tab-1', 'https://example.com/page')).resolves.toBeUndefined()
    await expect(gateway.assertTabOrigin('tab-1', 'https://attacker.test')).rejects.toThrow('地址已变化')
  })

  it('allows same-page drag and rejects stale or cross-page references', async () => {
    const fake = adapter()
    const gateway = new BrowserGateway(fake)
    const [source] = await gateway.find('tab-1', { text: 'Source' })
    const [target] = await gateway.find('tab-1', { text: 'Target' })
    await expect(gateway.drag(source, target, context('drag'))).resolves.toEqual({ ok: true })
    expect(fake.drag).toHaveBeenCalledTimes(1)
    await gateway.reload('tab-1')
    await expect(gateway.drag(source, target, context('stale-drag'))).rejects.toThrow('过期')
  })

  it('rejects an element screenshot when the reference belongs to another tab', async () => {
    const fake = adapter()
    const gateway = new BrowserGateway(fake)
    const [element] = await gateway.find('tab-1', { role: 'button' })

    await expect(gateway.screenshot('tab-2', element)).rejects.toThrow('不属于当前标签页')
    expect(fake.screenshot).not.toHaveBeenCalled()
  })

  it('bounds retained element references during repeated same-page searches', async () => {
    const fake = adapter()
    let backendNodeId = 0
    fake.find = vi.fn(async () => [{
      backendNodeId: ++backendNodeId, role: 'button', name: `Button ${backendNodeId}`, visible: true, disabled: false
    }])
    const gateway = new BrowserGateway(fake, { maxElementRefs: 3 })
    const references = []
    for (let index = 0; index < 8; index += 1) references.push((await gateway.find('tab-1', { role: 'button' }))[0])

    await expect(gateway.interact(references[0], { type: 'click' }, context('evicted'))).rejects.toThrow('过期')
    await expect(gateway.interact(references.at(-1)!, { type: 'click' }, context('retained'))).resolves.toEqual({ ok: true })
  })

  it('rejects oversized screenshots at the gateway boundary', async () => {
    const fake = adapter()
    fake.screenshot = vi.fn(async () => Buffer.alloc(2 * 1024 * 1024 + 1))
    await expect(new BrowserGateway(fake).screenshot('tab-1')).rejects.toThrow('截图超过大小限制')
  })

  it('requires a trusted risk level in browser write contexts', async () => {
    const gateway = new BrowserGateway(adapter())
    const [element] = await gateway.find('tab-1', { role: 'button' })
    await expect(gateway.interact(element, { type: 'click' }, {
      callId: 'missing-risk', source: 'agent', deadline: Date.now() + 1000
    } as never)).rejects.toThrow('上下文无效')
  })

  it('blocks typing into DOM-classified sensitive controls', async () => {
    const fake = adapter()
    fake.find = vi.fn(async () => [{
      backendNodeId: 7, role: 'textbox', name: 'Password', tag: 'input', visible: true, disabled: false, sensitive: true
    }])
    const gateway = new BrowserGateway(fake)
    const [field] = await gateway.find('tab-1', { css: '#password' })

    await expect(gateway.interact(field, { type: 'type', text: 'ordinary-looking-value' }, context('sensitive')))
      .rejects.toThrow('敏感字段')
    expect(fake.interact).not.toHaveBeenCalled()
  })

  it('requires a high-risk context for DOM-classified consequential clicks', async () => {
    const fake = adapter()
    fake.find = vi.fn(async () => [{
      backendNodeId: 8, role: 'button', name: 'Delete account', tag: 'button', visible: true, disabled: false, highRisk: true
    }])
    const gateway = new BrowserGateway(fake)
    const [button] = await gateway.find('tab-1', { css: '#delete' })

    await expect(gateway.interact(button, { type: 'click' }, context('ordinary-click'))).rejects.toThrow('高风险')
    await expect(gateway.interact(button, { type: 'click' }, context('confirmed-click', 'high'))).resolves.toEqual({ ok: true })
  })

  it('waits until the page reports a complete ready state', async () => {
    const fake = adapter()
    fake.pageState = vi.fn()
      .mockResolvedValueOnce({ title: '', url: 'https://example.com', readyState: 'loading' })
      .mockResolvedValueOnce({ title: 'Ready', url: 'https://example.com', readyState: 'interactive' })
    fake.inspect = vi.fn(async () => ({
      title: 'Ready', url: 'https://example.com', text: 'done', meta: {}, outline: [], readyState: 'interactive'
    }))
    const gateway = new BrowserGateway(fake)

    await expect(gateway.waitForPage('tab-1', 'https://example.com/page', 1_000, context('wait'))).resolves.toMatchObject({
      title: 'Ready', text: 'done'
    })
    expect(fake.pageState).toHaveBeenCalledTimes(2)
    expect(fake.inspect).toHaveBeenCalledTimes(1)
  })
})

function context(callId: string, risk: 'low' | 'medium' | 'high' = 'medium') { return { callId, source: 'agent', risk, deadline: Date.now() + 1000 } }
