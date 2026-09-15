import { describe, expect, it, vi } from 'vitest'
import type { AuditEvent, ToolExecutionContext } from '../../../shared/agent'
import { PluginMcpError } from './pluginMcpClient'
import { capturePluginMcpTaskTools, captureTaskPluginCapabilities } from './pluginMcpTools'

const connectionId = '11111111-1111-4111-8111-111111111111'
const schema = {
  type: 'object' as const,
  properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false as const
}

function context(taskId = 'task-1'): ToolExecutionContext {
  return {
    taskId, callId: 'call-1', workspace: { id: 'workspace-1', rootPath: 'D:\\repo', realRootPath: 'D:\\repo', createdAt: 1 },
    environment: 'local', permissionMode: 'ask-every-time', signal: new AbortController().signal
  }
}

describe('plugin MCP task tools', () => {
  it('accepts an empty closed object schema from an MCP server', async () => {
    const captured = await capturePluginMcpTaskTools([{ id: 'acme.tools' }], {
      snapshotPluginTools: async () => [{
        serverId: 'api', connectionId, serverOrigin: 'https://api.example.com',
        tools: [{ name: 'ping', inputSchema: { type: 'object', additionalProperties: false } }]
      }],
      acquireLease: vi.fn()
    })
    expect(captured.tools).toHaveLength(1)
    expect(captured.tools[0].parameters).toEqual({
      type: 'object', properties: {}, additionalProperties: false
    })
  })

  it('combines local and MCP task tools and disposes both snapshots', async () => {
    const localDispose = vi.fn(async () => undefined)
    const mcpRelease = vi.fn(async () => undefined)
    const localTool = { name: 'plugin.acme.tools.local' } as never
    const manager = {
      snapshotPluginTools: async () => [{
        serverId: 'api', connectionId, serverOrigin: 'https://api.example.com',
        tools: [{ name: 'search', inputSchema: schema }]
      }],
      acquireLease: async () => ({ listTools: vi.fn(), callTool: vi.fn(), release: mcpRelease })
    }
    const captured = await captureTaskPluginCapabilities({
      tools: [localTool], pluginIds: ['acme.tools'],
      pluginVersions: { 'acme.tools': '1.2.3' }, observe: vi.fn(), dispose: localDispose
    }, manager)
    await captured.tools[1].execute({ query: 'x' }, context())

    expect(captured.tools.map((tool) => tool.name)).toEqual(['plugin.acme.tools.local', 'mcp__acme.tools__api__search'])
    expect(captured.pluginIds).toEqual(['acme.tools'])
    await captured.dispose()
    expect(localDispose).toHaveBeenCalledOnce()
    expect(mcpRelease).toHaveBeenCalledOnce()
  })

  it('creates deterministic trusted definitions with frozen schemas and validates arguments', async () => {
    const snapshot = [{
      serverId: 'api', connectionId, serverOrigin: 'https://api.example.com', accountLabel: 'a***@example.com',
      tools: [{ name: 'search', description: 'Remote text', inputSchema: schema }]
    }]
    const manager = {
      snapshotPluginTools: vi.fn(async () => snapshot),
      acquireLease: vi.fn()
    }
    const captured = await capturePluginMcpTaskTools([{ id: 'acme.tools', version: '1.2.3' }], manager)
    snapshot[0].tools[0].inputSchema.properties.query.type = 'number' as 'string'

    expect(captured.tools).toHaveLength(1)
    expect(captured.tools[0]).toMatchObject({
      name: 'mcp__acme.tools__api__search', operation: 'external.call', plugin: { id: 'acme.tools', version: '1.2.3' },
      externalTarget: { pluginId: 'acme.tools', serverId: 'api', serverOrigin: 'https://api.example.com', toolName: 'search' },
      parameters: { properties: { query: { type: 'string' } } }
    })
    expect(captured.tools[0].validateArgs({ query: 'x' })).toBe(true)
    expect(captured.tools[0].validateArgs({ query: 1 })).toBe(false)
    expect(captured.tools[0].validateArgs({ query: 'x', extra: true })).toBe(false)
  })

  it('acquires one task-bound lease, invokes it with cancellation and releases it on dispose', async () => {
    const release = vi.fn(async () => undefined)
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'found' }] }))
    const manager = {
      snapshotPluginTools: async () => [{
        serverId: 'api', connectionId, serverOrigin: 'https://api.example.com',
        tools: [{ name: 'search', inputSchema: schema }]
      }],
      acquireLease: vi.fn(async () => ({ listTools: vi.fn(), callTool, release }))
    }
    const captured = await capturePluginMcpTaskTools([{ id: 'acme.tools' }], manager)
    const tool = captured.tools[0]
    await expect(tool.execute({ query: 'one' }, context())).resolves.toEqual({
      ok: true, value: { content: [{ type: 'text', text: 'found' }] }
    })
    await tool.execute({ query: 'two' }, context())

    expect(manager.acquireLease).toHaveBeenCalledOnce()
    expect(manager.acquireLease).toHaveBeenCalledWith({
      pluginId: 'acme.tools', serverId: 'api', connectionId, taskId: 'task-1'
    })
    expect(callTool).toHaveBeenLastCalledWith('search', { query: 'two' }, expect.any(AbortSignal))
    await captured.dispose()
    expect(release).toHaveBeenCalledOnce()
  })

  it('returns bounded stable failures and keeps another plugin snapshot available', async () => {
    const audit: AuditEvent[] = []
    const manager = {
      snapshotPluginTools: vi.fn(async (pluginId: string) => {
        if (pluginId === 'broken.plugin') throw new Error('secret discovery response')
        return [{ serverId: 'api', connectionId, serverOrigin: 'https://api.example.com', tools: [{ name: 'search', inputSchema: schema }] }]
      }),
      acquireLease: vi.fn(async () => ({
        listTools: vi.fn(), release: vi.fn(),
        callTool: async () => { throw new PluginMcpError('MCP_FORBIDDEN', 'remote secret body') }
      }))
    }
    const captured = await capturePluginMcpTaskTools(
      [{ id: 'broken.plugin' }, { id: 'healthy.plugin', version: '2.0.0' }], manager,
      (event) => audit.push(event)
    )
    expect(captured.tools).toHaveLength(1)
    const result = await captured.tools[0].execute({ query: 'x' }, context())
    expect(result).toEqual({ ok: false, error: { code: 'MCP_FORBIDDEN', message: '外部工具调用失败或已断开' } })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(audit).toEqual([expect.objectContaining({
      actor: 'model', action: 'external.call', outcome: 'failure', reasonCode: 'MCP_FORBIDDEN',
      toolName: 'search', pluginId: 'healthy.plugin', pluginVersion: '2.0.0',
      target: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    })])
    expect(JSON.stringify(audit)).not.toContain('remote secret body')
  })
})
