import { describe, expect, it, vi } from 'vitest'
import type { PluginMcpServerDeclaration } from '../../../shared/types'
import { createPluginMcpClient } from './pluginMcpClient'

const declaration: PluginMcpServerDeclaration = {
  id: 'api', url: 'https://mcp.example.com/mcp', transport: 'streamable-http', auth: 'none'
}

function controlledMcpFetch(tools: unknown[] = [{
  name: 'search', description: 'Search',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  annotations: { readOnlyHint: true }
}]): typeof fetch {
  return vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
    if (init?.method === 'GET') return new Response(null, { status: 405 })
    if (init?.method === 'DELETE') return new Response(null, { status: 200 })
    const request = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { name?: string } }
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const result = request.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } }
      : request.method === 'tools/list'
        ? { tools }
        : request.method === 'tools/call' && request.params?.name === 'search'
          ? { content: [{ type: 'text', text: 'found' }], isError: false, _meta: { secret: 'discard' } }
          : undefined
    return Response.json({ jsonrpc: '2.0', id: request.id, result })
  }) as typeof fetch
}

describe('plugin MCP client', () => {
  it('initializes, returns normalized tools, calls one and closes through Streamable HTTP', async () => {
    const fetcher = controlledMcpFetch()
    const client = createPluginMcpClient(declaration, {
      fetch: fetcher, resolveHostname: async () => ['93.184.216.34']
    })
    const signal = new AbortController().signal
    await client.connect(signal)
    expect(await client.listTools(signal)).toEqual([{
      name: 'search', description: 'Search',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }
    }])
    expect(await client.callTool('search', { query: 'x' }, signal)).toEqual({
      content: [{ type: 'text', text: 'found' }], isError: false
    })
    await client.close()
    expect(fetcher).toHaveBeenCalled()
  })

  it('rejects excessive, duplicate, or open tool schemas', async () => {
    const cases = [
      Array.from({ length: 65 }, (_, index) => ({ name: `tool_${index}`, inputSchema: { type: 'object', additionalProperties: false } })),
      [{ name: 'same', inputSchema: { type: 'object', additionalProperties: false } }, { name: 'same', inputSchema: { type: 'object', additionalProperties: false } }],
      [{ name: 'open', inputSchema: { type: 'object', properties: {} } }]
    ]
    for (const tools of cases) {
      const client = createPluginMcpClient(declaration, { fetch: controlledMcpFetch(tools), resolveHostname: async () => ['93.184.216.34'] })
      await client.connect(new AbortController().signal)
      await expect(client.listTools(new AbortController().signal)).rejects.toMatchObject({ code: 'MCP_TOOLS_INVALID' })
      await client.close()
    }
  })

  it('rejects private DNS answers before sending a request and bounds tool results', async () => {
    const fetcher = controlledMcpFetch()
    const blocked = createPluginMcpClient(declaration, { fetch: fetcher, resolveHostname: async () => ['127.0.0.1'] })
    await expect(blocked.connect(new AbortController().signal)).rejects.toMatchObject({ code: 'MCP_NETWORK_BLOCKED' })
    expect(fetcher).not.toHaveBeenCalled()

    const hugeFetch = controlledMcpFetch()
    ;(hugeFetch as ReturnType<typeof vi.fn>).mockImplementation(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id?: number; method: string }
      const result = request.method === 'initialize'
        ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } }
        : request.method === 'notifications/initialized' ? undefined
          : request.method === 'tools/list' ? { tools: [{ name: 'search', inputSchema: { type: 'object', additionalProperties: false } }] }
            : { content: [{ type: 'text', text: 'x'.repeat(201 * 1024) }] }
      if (request.method === 'notifications/initialized') return new Response(null, { status: 202 })
      return Response.json({ jsonrpc: '2.0', id: request.id, result })
    })
    const client = createPluginMcpClient(declaration, { fetch: hugeFetch, resolveHostname: async () => ['93.184.216.34'] })
    await client.connect(new AbortController().signal)
    await client.listTools(new AbortController().signal)
    await expect(client.callTool('search', {}, new AbortController().signal)).rejects.toMatchObject({ code: 'MCP_RESULT_TOO_LARGE' })
    await client.close()
  })
})
