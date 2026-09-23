import { describe, expect, it, vi } from 'vitest'
import { ChromeDevtoolsMcpAdapter } from './chromeDevtoolsMcpAdapter'
import type {
  ChromeDevtoolsMcpResult,
  ChromeDevtoolsMcpSession
} from './chromeDevtoolsMcpClient'

function session(
  handler: (name: string, args: Record<string, unknown>) => ChromeDevtoolsMcpResult
): ChromeDevtoolsMcpSession {
  return { callTool: vi.fn(async (name, args) => handler(name, args)), close: vi.fn() }
}

describe('ChromeDevtoolsMcpAdapter', () => {
  it('rejects missing or changed official result content instead of claiming a successful browser action', async () => {
    const missingPages = new ChromeDevtoolsMcpAdapter(session(() => ({ content: [] })))
    await expect(missingPages.listTabs()).rejects.toThrow('标签页结果无效')

    const missingSnapshot = new ChromeDevtoolsMcpAdapter(session(() => ({
      content: [{ type: 'text', text: 'snapshot moved to plain text' }]
    })))
    await expect(missingSnapshot.find('1', { role: 'button' })).rejects.toThrow('快照结构无效')

    const missingImage = new ChromeDevtoolsMcpAdapter(session(() => ({
      content: [{ type: 'text', text: 'screenshot saved elsewhere' }]
    })))
    await expect(missingImage.screenshot('1')).rejects.toThrow('未以内联图片返回截图')

    const changedEvaluation = new ChromeDevtoolsMcpAdapter(session(() => ({
      content: [{ type: 'text', text: '{"readyState":"complete"}' }]
    })))
    await expect(changedEvaluation.pageState('1')).rejects.toThrow('脚本结果格式无效')
  })

  it('maps page operations only to Google documented tool names and parameters', async () => {
    const fake = session((name) => {
      if (name === 'list_pages' || name === 'new_page') {
        return {
          content: [],
          structuredContent: {
            pages: [{ id: 7, url: 'https://example.com/', title: 'Example', selected: true }]
          }
        }
      }
      return { content: [] }
    })
    const adapter = new ChromeDevtoolsMcpAdapter(fake)

    expect(await adapter.listTabs()).toEqual([{
      id: '7', url: 'https://example.com/', title: 'Example', active: true
    }])
    await adapter.navigate('7', 'https://example.com/next')
    await adapter.reload('7')

    expect(fake.callTool).toHaveBeenNthCalledWith(1, 'list_pages', {}, undefined)
    expect(fake.callTool).toHaveBeenNthCalledWith(2, 'navigate_page', {
      pageId: 7, type: 'url', url: 'https://example.com/next'
    }, undefined)
    expect(fake.callTool).toHaveBeenNthCalledWith(3, 'navigate_page', {
      pageId: 7, type: 'reload'
    }, undefined)
  })

  it('selects another official page before closing the active page', async () => {
    const fake = session((name) => name === 'list_pages'
      ? {
          content: [],
          structuredContent: {
            pages: [
              { id: 7, url: 'https://active.example/', title: 'Active', selected: true },
              { id: 8, url: 'https://fallback.example/', title: 'Fallback', selected: false }
            ]
          }
        }
      : { content: [] })
    const adapter = new ChromeDevtoolsMcpAdapter(fake)

    await adapter.closeTab('7')

    expect(fake.callTool).toHaveBeenNthCalledWith(1, 'list_pages', {}, undefined)
    expect(fake.callTool).toHaveBeenNthCalledWith(2, 'select_page', {
      pageId: 8, bringToFront: false
    }, undefined)
    expect(fake.callTool).toHaveBeenNthCalledWith(3, 'close_page', { pageId: 7 }, undefined)
  })

  it('refuses to close the last page as documented by Google', async () => {
    const fake = session((name) => name === 'list_pages'
      ? {
          content: [],
          structuredContent: {
            pages: [{ id: 7, url: 'https://only.example/', title: 'Only', selected: true }]
          }
        }
      : { content: [] })
    const adapter = new ChromeDevtoolsMcpAdapter(fake)

    await expect(adapter.closeTab('7')).rejects.toThrow('不允许关闭最后一个标签页')
    expect(fake.callTool).toHaveBeenCalledTimes(1)
  })

  it('uses the official structured snapshot UID for element actions', async () => {
    const fake = session((name) => {
      if (name === 'take_snapshot') {
        return {
          content: [],
          structuredContent: {
            snapshot: {
              id: 'root', role: 'RootWebArea', children: [
                { id: 'submit-uid', role: 'button', name: 'Submit' }
              ]
            }
          }
        }
      }
      return { content: [{ type: 'text', text: 'ok' }] }
    })
    const adapter = new ChromeDevtoolsMcpAdapter(fake)
    const [button] = await adapter.find('4', { role: 'button', text: 'Submit' })
    await adapter.interact('4', button.backendNodeId, { type: 'click' })

    expect(fake.callTool).toHaveBeenNthCalledWith(1, 'take_snapshot', {
      pageId: 4, verbose: false
    }, undefined)
    expect(fake.callTool).toHaveBeenNthCalledWith(2, 'click', {
      pageId: 4, uid: 'submit-uid'
    }, undefined)
  })

  it('rejects locators that the stable official snapshot cannot map', async () => {
    const adapter = new ChromeDevtoolsMcpAdapter(session(() => ({ content: [] })))
    await expect(adapter.find('1', { css: '#submit' })).rejects.toThrow('官方 MCP')
    await expect(adapter.find('1', { tag: 'button' })).rejects.toThrow('官方 MCP')
  })

  it('does not add undocumented evaluate_script parameters', async () => {
    const fake = session((name) => {
      if (name === 'take_snapshot') {
        return {
          content: [],
          structuredContent: { snapshot: { id: 'root', role: 'RootWebArea' } }
        }
      }
      return name === 'evaluate_script'
        ? { content: [{ type: 'text', text: '```json\ntrue\n```' }] }
        : { content: [] }
    })
    const adapter = new ChromeDevtoolsMcpAdapter(fake)

    const [root] = await adapter.find('2', { role: 'RootWebArea' })
    await adapter.interact('2', root.backendNodeId, { type: 'scroll', y: 100 })

    expect(fake.callTool).toHaveBeenLastCalledWith('evaluate_script', {
      pageId: 2,
      function: '() => { window.scrollBy(0, 100); return true }'
    }, undefined)
  })

  it('polls page readiness through the official evaluate_script schema', async () => {
    const fake = session((name) => name === 'evaluate_script'
      ? {
          content: [{
            type: 'text',
            text: '```json\n{"title":"Ready","url":"https://example.com/","readyState":"interactive","pendingImages":2,"fontsLoaded":false,"resourceCount":14,"scrollHeight":2400}\n```'
          }]
        }
      : { content: [] })
    const adapter = new ChromeDevtoolsMcpAdapter(fake)

    await expect(adapter.pageState('3')).resolves.toEqual({
      title: 'Ready', url: 'https://example.com/', readyState: 'interactive',
      pendingImages: 2, fontsLoaded: false, resourceCount: 14, scrollHeight: 2400
    })
    expect(fake.callTool).toHaveBeenCalledWith('evaluate_script', {
      pageId: 3,
      function: expect.stringContaining('document.readyState')
    }, undefined)
  })

  it('captures the visible viewport explicitly instead of a full-page or element region', async () => {
    const fake = session((name) => name === 'take_screenshot'
      ? { content: [{ type: 'image', mimeType: 'image/jpeg', data: 'anBlZw==' }] }
      : { content: [] })
    const adapter = new ChromeDevtoolsMcpAdapter(fake)

    await adapter.screenshot('4')

    expect(fake.callTool).toHaveBeenCalledWith('take_screenshot', {
      pageId: 4,
      format: 'jpeg',
      quality: 70,
      fullPage: false
    }, undefined)
  })

  it('turns the official unavailable error into actionable Chrome setup guidance', async () => {
    const adapter = new ChromeDevtoolsMcpAdapter(session(() => ({
      isError: true,
      content: [{ type: 'text', text: 'Could not connect to Chrome. Could not find DevToolsActivePort.' }]
    })))

    await expect(adapter.listTabs()).rejects.toThrow('chrome://inspect/#remote-debugging')
  })

  it('invalidates element UIDs when the official server reports a Chrome reconnect', async () => {
    let snapshots = 0
    const fake = session((name) => {
      if (name === 'take_snapshot') {
        snapshots += 1
        if (snapshots === 1) {
          return {
            content: [],
            structuredContent: {
              snapshot: { id: 'root', children: [{ id: 'old-button', role: 'button' }] }
            }
          }
        }
        return {
          content: [],
          structuredContent: {
            reconnected: true,
            snapshot: { id: 'new-root', role: 'RootWebArea' }
          }
        }
      }
      return { content: [] }
    })
    const adapter = new ChromeDevtoolsMcpAdapter(fake)
    const [oldButton] = await adapter.find('1', { role: 'button' })

    await expect(adapter.find('1', { role: 'RootWebArea' })).rejects.toThrow('页面 ID 已变化')
    await expect(adapter.interact('1', oldButton.backendNodeId, { type: 'click' }))
      .rejects.toThrow('元素引用已失效')
  })
})
