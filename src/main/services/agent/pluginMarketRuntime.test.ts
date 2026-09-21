import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext } from '../../../shared/agent'
import type { AuditEvent } from '../../../shared/agent'
import type { PluginMarketEntry } from '../../../shared/types'
import { installMarketPlugin } from './pluginLifecycle'
import { capturePluginTaskTools, initPluginRegistry, resetPluginRuntimeForTests } from './pluginManager'

const tempDirs: string[] = []

afterEach(async () => {
  resetPluginRuntimeForTests()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('market plugin runtime', () => {
  it('captures a hook-only plugin and observes the task lifecycle without adding tools', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'ai-agent-hook-only-runtime-'))
    tempDirs.push(dataRoot)
    const pluginRoot = join(dataRoot, 'plugins', 'acme.hook-only')
    await mkdir(join(pluginRoot, 'hooks'), { recursive: true })
    await writeFile(join(pluginRoot, 'plugin.json'), JSON.stringify({
      schemaVersion: 1, id: 'acme.hook-only', name: 'Hook Only', version: '1.0.0', description: 'Hooks',
      hooks: { 'task.created': [{ entry: './hooks/created.mjs', priority: 5, timeoutMs: 500 }] }
    }))
    await writeFile(join(pluginRoot, 'hooks', 'created.mjs'), 'export default async () => undefined')
    initPluginRegistry(dataRoot)
    const invocations: Array<{ name: string; args: unknown }> = []
    const snapshot = await capturePluginTaskTools(['acme.hook-only'], () => ({
      invoke: async (name, args) => { invocations.push({ name, args }) },
      stop: async () => undefined
    }))

    expect(snapshot.pluginIds).toEqual(['acme.hook-only'])
    expect(snapshot.tools).toEqual([])
    snapshot.observe({
      taskId: 'task-hook', sessionId: 'session-hook', sequence: 1, type: 'task.created', timestamp: 1,
      payload: { id: 'task-hook', workspaceId: 'workspace-hook', rootPath: 'D:\\private' }
    })
    await snapshot.dispose()

    expect(invocations).toEqual([{ name: 'hook_0', args: { type: 'task.created', timestamp: 1, payload: {} } }])

    const audits: AuditEvent[] = []
    const failing = await capturePluginTaskTools(['acme.hook-only'], () => ({
      invoke: async () => { throw new Error('hook failed') }, stop: async () => undefined
    }), (audit) => audits.push(audit))
    for (let index = 0; index < 3; index += 1) failing.observe({
      taskId: `task-failure-${index}`, sessionId: 'session-hook', sequence: 1,
      type: 'task.created', timestamp: index + 2, payload: { workspaceId: 'workspace-hook' }
    })
    await failing.dispose()
    expect(audits.filter((audit) => audit.action === 'plugin.hook')).toHaveLength(3)
    expect(audits).toContainEqual(expect.objectContaining({
      action: 'plugin.isolation', pluginId: 'acme.hook-only', reasonCode: 'PLUGIN_ISOLATED'
    }))
  })

  it('captures an MCP-only plugin without creating a local worker', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'ai-agent-mcp-only-runtime-'))
    tempDirs.push(dataRoot)
    const pluginRoot = join(dataRoot, 'plugins', 'acme.mcp-only')
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(pluginRoot, 'plugin.json'), JSON.stringify({
      schemaVersion: 1, id: 'acme.mcp-only', name: 'MCP Only', version: '1.0.0',
      description: 'External tools only', permissions: ['network'], mcp: './mcp.json'
    }))
    await writeFile(join(pluginRoot, 'mcp.json'), JSON.stringify({ mcpServers: {
      api: { url: 'https://api.example.com/mcp', auth: 'none' }
    } }))
    initPluginRegistry(dataRoot)
    const workerFactory = (() => { throw new Error('MCP-only plugins must not create workers') }) as NonNullable<Parameters<typeof capturePluginTaskTools>[1]>

    const snapshot = await capturePluginTaskTools(['acme.mcp-only'], workerFactory)

    expect(snapshot.pluginIds).toEqual(['acme.mcp-only'])
    expect(snapshot.pluginVersions).toEqual({ 'acme.mcp-only': '1.0.0' })
    expect(snapshot.tools).toEqual([])
    await expect(snapshot.dispose()).resolves.toBeUndefined()
  })

  it('installs a verified market package and invokes its tool from a task snapshot', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'ai-agent-market-runtime-'))
    tempDirs.push(dataRoot)
    const installedRoot = join(dataRoot, 'plugins')
    const zip = new JSZip()
    zip.file('plugin.json', JSON.stringify({
      schemaVersion: 1,
      id: 'acme.market-runtime',
      name: 'Market Runtime',
      version: '1.0.0',
      description: 'Runnable market fixture',
      author: 'Acme',
      permissions: ['workspace.read'],
      tools: [{
        name: 'echo',
        description: 'Echo a value',
        entry: 'tools/echo.mjs',
        operation: 'fs.read',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false
        }
      }]
    }))
    zip.file('tools/echo.mjs', 'export default async ({ value }, context) => ({ value, taskId: context.taskId })')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    const entry: PluginMarketEntry = {
      id: 'acme.market-runtime', name: 'Market Runtime', version: '1.0.0',
      description: 'Runnable market fixture', author: 'Acme', sourceId: 'source-test',
      sourceName: 'Test', sourceKind: 'community', verified: false,
      packageUrl: 'https://plugins.example/acme.zip',
      sha256: createHash('sha256').update(bytes).digest('hex'), permissions: ['workspace.read'],
      categories: ['developer-tools'], platforms: [], architectures: [], components: ['tools']
    }

    await installMarketPlugin(entry, dataRoot, installedRoot, async () => new Response(new Uint8Array(bytes)))
    initPluginRegistry(dataRoot)
    type Factory = NonNullable<Parameters<typeof capturePluginTaskTools>[1]>
    const workerFactory: Factory = (rootPath, manifest) => ({
      invoke: async (toolName, args, context) => {
        const tool = manifest.tools.find((candidate) => candidate.name === toolName)
        if (!tool) throw new Error('missing tool')
        await readFile(join(rootPath, tool.entry))
        const loaded = await import(`${pathToFileURL(join(rootPath, tool.entry)).href}?test=${Date.now()}`)
        return loaded.default(args, context)
      },
      stop: async () => undefined
    })
    const snapshot = await capturePluginTaskTools(['acme.market-runtime'], workerFactory)
    const context: ToolExecutionContext = {
      taskId: 'task-market-runtime', callId: 'call-market-runtime',
      workspace: { id: 'workspace-market', rootPath: dataRoot, realRootPath: dataRoot, createdAt: 1 },
      environment: 'local', permissionMode: 'smart-approval', signal: new AbortController().signal
    }

    expect(snapshot.pluginIds).toEqual(['acme.market-runtime'])
    expect(snapshot.pluginVersions).toEqual({ 'acme.market-runtime': '1.0.0' })
    await expect(snapshot.tools[0].execute({ value: 'works' }, context)).resolves.toEqual({
      ok: true, value: { value: 'works', taskId: 'task-market-runtime' }
    })
    await snapshot.dispose()

    const events: AuditEvent[] = []
    const stopReasons: string[] = []
    const failing = await capturePluginTaskTools(['acme.market-runtime'], () => ({
      invoke: async () => { throw new Error('PLUGIN_STARTUP_TIMEOUT') },
      stop: async (reason) => { stopReasons.push(reason ?? 'unspecified') }
    }), (event) => events.push(event))
    for (let attempt = 0; attempt < 3; attempt += 1) await failing.tools[0].execute({ value: 'fails' }, context)
    expect(events.filter((event) => event.action === 'plugin.start')).toHaveLength(3)
    expect(events).toContainEqual(expect.objectContaining({
      action: 'plugin.isolation', reasonCode: 'PLUGIN_ISOLATED', pluginId: 'acme.market-runtime',
      pluginVersion: '1.0.0', taskId: context.taskId, workspaceId: context.workspace.id
    }))
    await vi.waitFor(() => expect(stopReasons).toContain('plugin_quarantined'))
    await failing.dispose()
  })

  it('rejects a package whose manifest requests permissions not shown by the market', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'ai-agent-market-mismatch-'))
    tempDirs.push(dataRoot)
    const installedRoot = join(dataRoot, 'plugins')
    const zip = new JSZip()
    zip.file('plugin.json', JSON.stringify({
      schemaVersion: 1, id: 'acme.mismatch', name: 'Mismatch', version: '1.0.0', author: 'Acme',
      description: 'Mismatch fixture', permissions: ['workspace.write'],
      tools: [{ name: 'write', description: 'Write a value', entry: 'tools/write.mjs', operation: 'fs.patch',
        parameters: { type: 'object', properties: {}, additionalProperties: false } }]
    }))
    zip.file('tools/write.mjs', 'export default async () => ({ ok: true })')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    const entry: PluginMarketEntry = {
      id: 'acme.mismatch', name: 'Mismatch', version: '1.0.0', description: 'Mismatch fixture', author: 'Acme',
      sourceId: 'source-test', sourceName: 'Test', sourceKind: 'community', verified: false,
      packageUrl: 'https://plugins.example/mismatch.zip', sha256: createHash('sha256').update(bytes).digest('hex'),
      permissions: ['workspace.read'], categories: [], platforms: [], architectures: [], components: ['tools']
    }

    await expect(installMarketPlugin(entry, dataRoot, installedRoot, async () => new Response(new Uint8Array(bytes))))
      .rejects.toThrow('市场展示不一致')
    await expect(readFile(join(installedRoot, entry.id, 'plugin.json'))).rejects.toThrow()
  })
})
