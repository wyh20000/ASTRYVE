import { describe, expect, it, vi } from 'vitest'
import { LazyChromeDevtoolsMcpSession } from './officialChromeBrowserRuntime'
import type { ChromeDevtoolsMcpSession } from './chromeDevtoolsMcpClient'

function connectedSession(): ChromeDevtoolsMcpSession {
  return {
    callTool: vi.fn(async () => ({ content: [] })),
    close: vi.fn(async () => undefined)
  }
}

describe('LazyChromeDevtoolsMcpSession', () => {
  it('starts the official process only on first use and shares one connection', async () => {
    const connected = connectedSession()
    const connect = vi.fn(async () => connected)
    const lazy = new LazyChromeDevtoolsMcpSession(connect)

    expect(connect).not.toHaveBeenCalled()
    await Promise.all([
      lazy.callTool('list_pages', {}),
      lazy.callTool('list_pages', {})
    ])

    expect(connect).toHaveBeenCalledTimes(1)
    expect(connected.callTool).toHaveBeenCalledTimes(2)
  })

  it('allows a later tool call to retry after connection failure', async () => {
    const connected = connectedSession()
    const connect = vi.fn()
      .mockRejectedValueOnce(new Error('remote debugging disabled'))
      .mockResolvedValueOnce(connected)
    const lazy = new LazyChromeDevtoolsMcpSession(connect)

    await expect(lazy.callTool('list_pages', {})).rejects.toThrow('remote debugging disabled')
    await expect(lazy.callTool('list_pages', {})).resolves.toEqual({ content: [] })
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('closes an in-flight official connection and rejects later calls', async () => {
    const connected = connectedSession()
    let resolveConnection!: (value: ChromeDevtoolsMcpSession) => void
    const connect = () => new Promise<ChromeDevtoolsMcpSession>((resolve) => {
      resolveConnection = resolve
    })
    const lazy = new LazyChromeDevtoolsMcpSession(connect)
    const call = lazy.callTool('list_pages', {})
    const closing = lazy.close()
    resolveConnection(connected)

    await expect(call).rejects.toThrow('已关闭')
    await closing
    expect(connected.close).toHaveBeenCalledTimes(1)
    await expect(lazy.callTool('list_pages', {})).rejects.toThrow('已关闭')
  })

  it('disconnects the active process and reconnects on the next use', async () => {
    const first = connectedSession()
    const second = connectedSession()
    const connect = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const lazy = new LazyChromeDevtoolsMcpSession(connect)

    await lazy.callTool('list_pages', {})
    await lazy.disconnect()
    expect(first.close).toHaveBeenCalledTimes(1)
    await lazy.callTool('list_pages', {})

    expect(connect).toHaveBeenCalledTimes(2)
    expect(second.callTool).toHaveBeenCalledTimes(1)
  })

  it('invalidates a broken active connection so the next call reconnects', async () => {
    const first = connectedSession()
    vi.mocked(first.callTool).mockRejectedValueOnce(new Error('socket connection closed'))
    const second = connectedSession()
    const connect = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const lazy = new LazyChromeDevtoolsMcpSession(connect)

    await expect(lazy.callTool('list_pages', {})).rejects.toThrow('连接已中断')
    expect(first.close).toHaveBeenCalledTimes(1)
    await expect(lazy.callTool('list_pages', {})).resolves.toEqual({ content: [] })
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('invalidates an official MCP request timeout without replaying the call', async () => {
    const first = connectedSession()
    vi.mocked(first.callTool).mockRejectedValueOnce(new Error('Request timed out'))
    const second = connectedSession()
    const connect = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const lazy = new LazyChromeDevtoolsMcpSession(connect)

    await expect(lazy.callTool('list_pages', {})).rejects.toThrow('连接已中断')
    expect(first.callTool).toHaveBeenCalledTimes(1)
    expect(first.close).toHaveBeenCalledTimes(1)
    await expect(lazy.callTool('list_pages', {})).resolves.toEqual({ content: [] })
    expect(connect).toHaveBeenCalledTimes(2)
  })
})
