import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolExecutionContext } from '../../../shared/agent'
import type { PluginMarketEntry } from '../../../shared/types'
import { installMarketPlugin } from './pluginLifecycle'
import { capturePluginTaskTools, initPluginRegistry } from './pluginManager'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('market plugin runtime', () => {
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
      categories: ['developer-tools'], platforms: [], architectures: []
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
  })
})
