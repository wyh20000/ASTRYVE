import { describe, expect, it, vi } from 'vitest'
import { BrowserGateway, type BrowserAdapter } from './browserGateway'

function adapter(): BrowserAdapter {
  return {
    listTabs: vi.fn(async () => [{ id: 'tab-1', title: 'Example', url: 'https://example.com', active: true }]),
    createTab: vi.fn(async () => 'tab-2'), activateTab: vi.fn(async () => undefined), closeTab: vi.fn(async () => undefined),
    history: vi.fn(async () => undefined), reload: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
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

  it('redacts sensitive values and limits page text', async () => {
    const gateway = new BrowserGateway(adapter(), { maxText: 20 })
    await gateway.listTabs()
    const result = await gateway.inspect('tab-1')
    expect(result.text).not.toContain('secret')
    expect(result.text.length).toBeLessThanOrEqual(20)
    expect(result.textTruncated).toBe(true)
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

  it('blocks navigation denied by site policy', async () => {
    const gateway = new BrowserGateway(adapter(), { canNavigate: (url) => url.hostname !== 'blocked.test' })
    await expect(gateway.createTab('https://blocked.test')).rejects.toThrow('阻止')
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
    fake.inspect = vi.fn()
      .mockResolvedValueOnce({ title: '', url: 'https://example.com', text: '', meta: {}, outline: [], readyState: 'loading' })
      .mockResolvedValueOnce({ title: 'Ready', url: 'https://example.com', text: 'done', meta: {}, outline: [], readyState: 'complete' })
    const gateway = new BrowserGateway(fake)

    await expect(gateway.waitForPage('tab-1', 'https://example.com/page', 1_000, context('wait'))).resolves.toMatchObject({
      title: 'Ready', text: 'done'
    })
    expect(fake.inspect).toHaveBeenCalledTimes(2)
  })
})

function context(callId: string, risk: 'low' | 'medium' | 'high' = 'medium') { return { callId, source: 'agent', risk, deadline: Date.now() + 1000 } }
