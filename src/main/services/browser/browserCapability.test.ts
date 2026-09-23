import { describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext } from '../../../shared/agent'
import type { BrowserGateway } from './browserGateway'
import { BrowserCapability } from './browserCapability'

const context: ToolExecutionContext = {
  taskId: 'task-1', callId: 'call-1',
  workspace: { id: 'capability:session-1', rootPath: 'D:\\isolated', realRootPath: 'D:\\isolated', createdAt: 1 },
  permissionMode: 'ask-every-time', environment: 'local', signal: new AbortController().signal
}

function setup(pages: Array<{ id: string; title: string; url: string; active: boolean; pageVersion: number }>) {
  const listTabs = vi.fn(async () => pages)
  const gateway = { listTabs } as unknown as BrowserGateway
  let generation = 1
  const release = vi.fn(async () => { generation += 1 })
  const acquire = vi.fn(() => release)
  const audit = vi.fn()
  const capability = new BrowserCapability(gateway, acquire, audit, () => generation)
  return { capability, listTabs, acquire, release, audit, reconnect: () => { generation += 1 } }
}

describe('browser.activate', () => {
  it('is dormant until the model calls it, then lists official pages once and narrows tools by purpose', async () => {
    const { capability, listTabs, acquire, release, audit } = setup([
      { id: '1', title: 'Example', url: 'https://example.com/', active: false, pageVersion: 1 }
    ])
    const tool = capability.tool()
    expect(tool.validateArgs({ purpose: 'screenshot' })).toBe(true)
    expect(tool.validateArgs({ purpose: 'screenshot', targetHint: { url: 'file:///secret' } })).toBe(false)
    expect(acquire).not.toHaveBeenCalled()
    expect(listTabs).not.toHaveBeenCalled()
    expect([...capability.allowedToolNames(context.taskId)]).toEqual([])

    const result = await tool.execute({ purpose: 'screenshot' }, context)
    expect(result).toMatchObject({ ok: true, value: { status: 'activated', pages: [{ id: '1' }] } })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(listTabs).toHaveBeenCalledTimes(1)
    expect(capability.allowedToolNames(context.taskId).has('browser.screenshot')).toBe(true)
    expect(capability.allowedToolNames(context.taskId).has('browser.click')).toBe(false)
    expect(capability.mayUseTool(context.taskId, 'browser.screenshot', {
      tabId: '1', url: 'https://example.com/'
    })).toBe(true)
    expect(capability.mayUseTool(context.taskId, 'browser.screenshot', {
      tabId: '2', url: 'https://example.com/'
    })).toBe(false)
    expect(capability.mayUseTool(context.taskId, 'browser.screenshot', {
      tabId: '1', url: 'https://other.test/'
    })).toBe(false)

    await tool.execute({ purpose: 'interact' }, { ...context, callId: 'call-2' })
    expect(listTabs).toHaveBeenCalledTimes(1)
    expect(capability.allowedToolNames(context.taskId).has('browser.click')).toBe(false)
    expect(audit.mock.calls.map(([event]) => event.metadata.status)).toEqual(['requested', 'activated'])
    await capability.release(context.taskId)
    await capability.release(context.taskId)
    expect(release).toHaveBeenCalledTimes(1)
    expect([...capability.allowedToolNames(context.taskId)]).toEqual([])
  })

  it('matches a unique sanitized hint without trusting the selected flag', async () => {
    const { capability } = setup([
      { id: '1', title: 'One', url: 'https://one.test/', active: true, pageVersion: 1 },
      { id: '2', title: 'Two', url: 'https://two.test/', active: false, pageVersion: 1 }
    ])
    const result = await capability.tool().execute({ purpose: 'inspect', targetHint: {
      url: 'https://two.test/?private=secret#fragment', title: 'Two'
    } }, context)
    expect(result).toMatchObject({ ok: true, value: {
      status: 'activated', pages: [{ id: '2', url: 'https://two.test/' }]
    } })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('does not expose page tools or keep a lease when multiple pages need selection', async () => {
    const { capability, listTabs, release, audit } = setup([
      { id: '1', title: 'One', url: 'https://one.test/', active: true, pageVersion: 1 },
      { id: '2', title: 'Two', url: 'https://two.test/', active: false, pageVersion: 1 }
    ])
    const result = await capability.tool().execute({ purpose: 'inspect' }, context)
    expect(result).toMatchObject({ ok: true, value: { status: 'needs-selection' } })
    expect([...capability.allowedToolNames(context.taskId)]).toEqual([])
    expect(release).toHaveBeenCalledTimes(1)
    expect(audit.mock.calls.at(-1)?.[0].metadata.status).toBe('needs-selection')
    await capability.tool().execute({ purpose: 'inspect' }, { ...context, callId: 'call-2' })
    expect(listTabs).toHaveBeenCalledTimes(1)
  })

  it('releases a failed connection and never claims activation', async () => {
    const { capability, listTabs, release, audit } = setup([])
    listTabs.mockRejectedValueOnce(new Error('Chrome unavailable'))
    const result = await capability.tool().execute({ purpose: 'inspect' }, context)
    expect(result).toMatchObject({ ok: false, error: { code: 'BROWSER_ACTIVATION_FAILED' } })
    expect([...capability.allowedToolNames(context.taskId)]).toEqual([])
    expect(release).toHaveBeenCalledTimes(1)
    expect(audit.mock.calls.at(-1)?.[0].metadata.status).toBe('failed')
  })

  it('revokes the old page after history changes its URL', async () => {
    const { capability, release } = setup([
      { id: '1', title: 'Example', url: 'https://example.com/', active: true, pageVersion: 1 }
    ])
    await capability.tool().execute({ purpose: 'interact' }, context)
    expect(capability.mayUseTool(context.taskId, 'browser.history', { tabId: '1', direction: 'back' })).toBe(true)
    await capability.observeToolResult(context.taskId, 'browser.history', { tabId: '1' }, { navigated: true })
    expect(capability.allowedToolNames(context.taskId).size).toBe(0)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('invalidates page tools after the official MCP reconnects', async () => {
    const { capability, reconnect, release } = setup([
      { id: '1', title: 'Example', url: 'https://example.com/', active: true, pageVersion: 1 }
    ])
    await capability.tool().execute({ purpose: 'inspect' }, context)
    expect(capability.allowedToolNames(context.taskId).has('browser.inspect')).toBe(true)
    reconnect()
    expect(capability.allowedToolNames(context.taskId).size).toBe(0)
    expect(capability.mayUseTool(context.taskId, 'browser.inspect', {
      tabId: '1', url: 'https://example.com/'
    })).toBe(false)
    await capability.tool().execute({ purpose: 'inspect' }, { ...context, callId: 'call-2' })
    expect(release).toHaveBeenCalledTimes(1)
    expect(capability.allowedToolNames(context.taskId).has('browser.inspect')).toBe(true)
  })

  it('rebinds to a newly opened page and rejects the previous page ID', async () => {
    const { capability } = setup([
      { id: '1', title: 'Start', url: 'https://start.test/', active: true, pageVersion: 1 }
    ])
    await capability.tool().execute({ purpose: 'interact' }, context)
    expect(capability.mayUseTool(context.taskId, 'browser.openTab', { url: 'https://next.test/' })).toBe(true)
    await capability.observeToolResult(context.taskId, 'browser.openTab',
      { url: 'https://next.test/' }, { tabId: '2', loaded: false })
    expect(capability.mayUseTool(context.taskId, 'browser.inspect', {
      tabId: '1', url: 'https://start.test/'
    })).toBe(false)
    expect(capability.mayUseTool(context.taskId, 'browser.inspect', {
      tabId: '2', url: 'https://next.test/'
    })).toBe(true)
  })
})
