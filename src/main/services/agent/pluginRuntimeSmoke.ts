import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import type { AuditEvent, ToolExecutionContext } from '../../../shared/agent'
import type { PluginMarketEntry } from '../../../shared/types'
import { installMarketPlugin } from './pluginLifecycle'
import { capturePluginTaskTools, initPluginRegistry } from './pluginManager'

export async function runPluginRuntimeSmoke(): Promise<void> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'ai-agent-plugin-smoke-'))
  let dispose: (() => Promise<void>) | undefined
  try {
    const zip = new JSZip()
    zip.file('plugin.json', JSON.stringify({
      schemaVersion: 1, id: 'smoke.market-plugin', name: 'Smoke market plugin', version: '1.0.0',
      description: 'Verifies the real isolated plugin worker', author: 'ASTRYVE', permissions: ['workspace.read'],
      hooks: { 'task.created': [{ entry: 'hooks/created.mjs', priority: 1, timeoutMs: 500 }] },
      tools: [{
        name: 'echo', description: 'Echo smoke input', entry: 'tools/echo.mjs', operation: 'fs.read',
        parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }
      }]
    }))
    zip.file('tools/echo.mjs', 'export default async ({value},context)=>({value,taskId:context.taskId})')
    zip.file('hooks/created.mjs', 'export default async ()=>{throw new Error("expected smoke hook") }')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    const entry: PluginMarketEntry = {
      id: 'smoke.market-plugin', name: 'Smoke market plugin', version: '1.0.0', description: 'Smoke', author: 'ASTRYVE',
      sourceId: 'source-smoke', sourceName: 'Smoke', sourceKind: 'community', verified: false,
      packageUrl: 'https://plugins.invalid/smoke.zip', sha256: createHash('sha256').update(bytes).digest('hex'),
      permissions: ['workspace.read'], categories: ['test'], platforms: [], architectures: [], components: ['tools', 'hooks']
    }
    await installMarketPlugin(entry, dataRoot, join(dataRoot, 'plugins'), async () => new Response(new Uint8Array(bytes)))
    initPluginRegistry(dataRoot)
    const audits: AuditEvent[] = []
    const snapshot = await capturePluginTaskTools(['smoke.market-plugin'], undefined, (event) => audits.push(event))
    dispose = snapshot.dispose
    const context: ToolExecutionContext = {
      taskId: 'task-plugin-smoke', callId: 'call-plugin-smoke',
      workspace: { id: 'workspace-plugin-smoke', rootPath: dataRoot, realRootPath: dataRoot, createdAt: Date.now() },
      environment: 'local', permissionMode: 'smart-approval', signal: new AbortController().signal
    }
    const result = await snapshot.tools[0].execute({ value: 'worker-ok' }, context)
    if (!result.ok || (result.value as { value?: string; taskId?: string })?.value !== 'worker-ok' ||
        (result.value as { taskId?: string })?.taskId !== context.taskId) {
      throw new Error(`Unexpected plugin result: ${JSON.stringify(result)}`)
    }
    snapshot.observe({
      taskId: context.taskId, sessionId: 'session-plugin-smoke', sequence: 1,
      type: 'task.created', timestamp: Date.now(), payload: { workspaceId: context.workspace.id }
    })
    await snapshot.dispose()
    dispose = undefined
    if (!audits.some((event) => event.action === 'plugin.hook' && event.reasonCode === 'PLUGIN_HOOK_FAILED')) {
      throw new Error('Real plugin hook was not observed')
    }
  } finally {
    await dispose?.().catch(() => undefined)
    await rm(dataRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}
