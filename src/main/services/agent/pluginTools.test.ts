import { describe, expect, it, vi } from 'vitest'
import type { ParsedPluginManifest } from './pluginManifest'
import { createPluginTools } from './pluginTools'

const plugin: ParsedPluginManifest = {
  id: 'acme.browser-tools',
  name: 'Browser Tools',
  version: '1.2.3',
  description: 'Test plugin',
  sourceFormat: 'native',
  permissions: ['workspace.read'],
  capabilities: [],
  components: ['tools'],
  hooks: [],
  assetPaths: [],
  tools: [{
    name: 'inspect_dom',
    description: 'Inspect a saved DOM document',
    entry: 'tools/inspect.mjs',
    operation: 'fs.read',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false
    }
  }]
}

describe('plugin tools', () => {
  it('creates canonical tools and delegates only trusted context to the worker', async () => {
    const invoke = vi.fn(async () => ({ title: 'ok' }))
    const [tool] = createPluginTools(plugin, { invoke })
    const controller = new AbortController()

    expect(tool.name).toBe('plugin.acme.browser-tools.inspect_dom')
    expect(tool.plugin).toEqual({ id: 'acme.browser-tools', version: '1.2.3' })
    expect(tool.parameters).not.toBe(plugin.tools[0].parameters)
    expect(tool.validateArgs({ path: 'src/main.ts' })).toBe(true)
    expect(tool.validateArgs({ path: 'src/main.ts', extra: true })).toBe(false)
    await expect(tool.execute({ path: 'src/main.ts' }, {
      taskId: 'task-123456789012', callId: 'call-123456789012',
      workspace: { id: 'workspace-123456', rootPath: 'D:/work', realRootPath: 'D:/work', createdAt: 1 },
      environment: 'local', permissionMode: 'smart-approval', signal: controller.signal
    })).resolves.toEqual({ ok: true, value: { title: 'ok' } })
    expect(invoke).toHaveBeenCalledWith('inspect_dom', { path: 'src/main.ts' }, {
      taskId: 'task-123456789012', workspaceId: 'workspace-123456'
    }, controller.signal)
  })

  it('rejects unsupported permission/operation combinations', () => {
    expect(() => createPluginTools({
      ...plugin,
      permissions: [],
      tools: [{ ...plugin.tools[0], operation: 'process.run' }]
    }, { invoke: vi.fn() })).toThrow('未声明 process 权限')
  })

  it('reports startup failures with trusted execution context and a stable reason code', async () => {
    const failure = new Error('PLUGIN_STARTUP_TIMEOUT')
    const failed = vi.fn()
    const [tool] = createPluginTools(plugin, { invoke: vi.fn(async () => { throw failure }) }, { failed })
    const context = {
      taskId: 'task-audit', callId: 'call-audit',
      workspace: { id: 'workspace-audit', rootPath: 'D:/work', realRootPath: 'D:/work', createdAt: 1 },
      environment: 'local' as const, permissionMode: 'smart-approval' as const,
      signal: new AbortController().signal
    }

    await expect(tool.execute({ path: 'src/main.ts' }, context)).resolves.toMatchObject({ ok: false })
    expect(failed).toHaveBeenCalledWith(failure, context, 'PLUGIN_START_FAILED')
  })
})
