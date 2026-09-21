import { join } from 'node:path'
import { mkdir, readdir } from 'node:fs/promises'
import type { PluginMetadata } from '../../../shared/types'
import type { TaskEvent, ToolDefinition } from '../../../shared/agent'
import { randomUUID } from 'node:crypto'
import type { AuditWriter } from './policyEngine'
import { getDisabledPluginIds } from '../settings'
import { PluginRegistry } from './pluginRegistry'
import { readPluginManifest, type ParsedPluginManifest } from './pluginManifest'
import { PluginWorkerHost } from './pluginWorker'
import { createPluginTools, type PluginToolWorker } from './pluginTools'
import { clearPluginFailure, isPluginQuarantined, recordPluginFailure, recoverPluginHealth, resetPluginHealth } from './pluginHealth'
import { PluginRuntimeRegistry } from './pluginRuntimeRegistry'
import { loadPluginInstallOrigins } from './pluginProvenance'
import { loadPluginDeploymentPolicy, type PluginDeploymentPolicy } from './pluginDeploymentPolicy'
import { PluginHookController, type PluginHookRegistration } from './pluginHooks'

let registry: PluginRegistry | undefined
let installedRoot: string | undefined
let pluginDataRoot: string | undefined
const activeRuntimes = new PluginRuntimeRegistry()
let deploymentPolicy: Promise<PluginDeploymentPolicy> = Promise.resolve({ managedPluginIds: new Set() })

export function initPluginRegistry(userDataPath: string, deploymentRoot = process.resourcesPath): void {
  pluginDataRoot = userDataPath
  installedRoot = join(userDataPath, 'plugins')
  registry = new PluginRegistry(installedRoot, getDisabledPluginIds)
  deploymentPolicy = loadPluginDeploymentPolicy(deploymentRoot)
}

export function getInstalledPluginRoot(): string {
  if (!installedRoot) throw new Error('Plugin registry not initialized')
  return installedRoot
}

export async function listPlugins(): Promise<PluginMetadata[]> {
  if (!registry) throw new Error('Plugin registry not initialized')
  const origins = pluginDataRoot ? await loadPluginInstallOrigins(pluginDataRoot) : {}
  const policy = await deploymentPolicy
  return (await registry.list()).map((plugin) => {
    const origin = origins[plugin.id]
    const metadata = origin && origin.pluginVersion === plugin.version ? { ...plugin, installOrigin: origin } : plugin
    const managed = policy.managedPluginIds.has(plugin.id)
    return isPluginQuarantined(plugin.id) ? {
      ...metadata, enabled: false, status: 'quarantined' as const,
      errors: ['插件连续启动或执行失败，已自动隔离；重新启动应用后可重试'],
      ...(managed ? { managed: true } : {})
    } : managed ? { ...metadata, managed: true } : metadata
  })
}

export async function listEnabledPluginSkillRoots(): Promise<Array<{
  root: string
  boundaryRoot: string
  pluginId: string
  version?: string
}>> {
  return listPluginSkillRoots()
}

/** Read-only discovery used by plugin details, including plugins that are not enabled yet. */
export async function listInstalledPluginSkillRoots(pluginId: string): Promise<Array<{
  root: string
  boundaryRoot: string
  pluginId: string
  version?: string
}>> {
  return listPluginSkillRoots(pluginId, true)
}

async function listPluginSkillRoots(pluginId?: string, includeDisabled = false): Promise<Array<{
  root: string
  boundaryRoot: string
  pluginId: string
  version?: string
}>> {
  const root = getInstalledPluginRoot()
  await mkdir(root, { recursive: true })
  const disabled = getDisabledPluginIds()
  const entries = await readdir(root, { withFileTypes: true })
  const result: Array<{ root: string; boundaryRoot: string; pluginId: string; version?: string }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue
    try {
      const boundaryRoot = join(root, entry.name)
      const manifest = await readPluginManifest(boundaryRoot)
      if (!manifest.skillsPath || (pluginId && manifest.id !== pluginId) ||
          (!includeDisabled && (disabled.has(manifest.id) || isPluginQuarantined(manifest.id)))) continue
      result.push({ root: join(boundaryRoot, manifest.skillsPath), boundaryRoot, pluginId: manifest.id, version: manifest.version })
    } catch {
      // Invalid plugins never contribute Skills.
    }
  }
  return result.sort((a, b) => a.pluginId.localeCompare(b.pluginId))
}

export interface PluginTaskTools {
  tools: ToolDefinition<any, any>[]
  pluginIds: string[]
  pluginVersions: Record<string, string | undefined>
  observe: (event: TaskEvent) => void
  dispose: () => Promise<void>
}

export interface PluginTaskWorker extends PluginToolWorker {
  stop(reason?: string): Promise<void>
}

export type PluginTaskWorkerFactory = (
  rootPath: string,
  manifest: ParsedPluginManifest
) => PluginTaskWorker

/** Captures enabled plugin code and schemas for one task. Later installs/toggles cannot mutate it. */
export async function capturePluginTaskTools(
  requestedIds?: readonly string[],
  createWorker: PluginTaskWorkerFactory = (rootPath, manifest) => new LazyPluginWorker(rootPath, manifest),
  writeAudit: AuditWriter = () => undefined
): Promise<PluginTaskTools> {
  const root = getInstalledPluginRoot()
  await mkdir(root, { recursive: true })
  const disabled = getDisabledPluginIds()
  const requested = requestedIds?.length ? new Set(requestedIds) : undefined
  const entries = await readdir(root, { withFileTypes: true })
  const packages: Array<{ rootPath: string; manifest: ParsedPluginManifest }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue
    try {
      const rootPath = join(root, entry.name)
      const manifest = await readPluginManifest(rootPath)
      if ((!manifest.tools.length && !manifest.hooks.length && !manifest.mcpPath) || disabled.has(manifest.id) || isPluginQuarantined(manifest.id) || (requested && !requested.has(manifest.id))) continue
      packages.push({ rootPath, manifest })
    } catch {
      // Invalid packages remain visible in settings but never enter a task tool snapshot.
    }
  }
  if (requested) {
    const found = new Set(packages.map((item) => item.manifest.id))
    const missing = [...requested].filter((id) => !found.has(id))
    if (missing.length) throw new Error(`插件不可用：${missing.map((id) => `@${id}`).join('、')}`)
  }
  packages.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
  const workers: Array<{ worker: PluginTaskWorker; unregister: () => void }> = []
  const tools: ToolDefinition<any, any>[] = []
  const hookRegistrations: PluginHookRegistration[] = []
  const versions: Record<string, string | undefined> = {}
  for (const item of packages) {
    versions[item.manifest.id] = item.manifest.version
    if (!item.manifest.tools.length && !item.manifest.hooks.length) continue
    const worker = createWorker(item.rootPath, item.manifest)
    const pluginTools = item.manifest.tools.length ? createPluginTools(item.manifest, worker, {
      succeeded: () => clearPluginFailure(item.manifest.id),
      failed: (_error, context, reasonCode) => {
        try {
          writeAudit({
            id: randomUUID(), timestamp: Date.now(), taskId: context.taskId,
            workspaceId: context.workspace.id, actor: 'system',
            action: reasonCode === 'PLUGIN_START_FAILED' ? 'plugin.start' : 'plugin.execute',
            outcome: 'failure', risk: 'high', reasonCode,
            pluginId: item.manifest.id, pluginVersion: item.manifest.version
          })
        } catch { /* preserve the plugin failure result */ }
        const wasQuarantined = isPluginQuarantined(item.manifest.id)
        if (recordPluginFailure(item.manifest.id) && !wasQuarantined) {
          void activeRuntimes.stopAll(item.manifest.id, 'plugin_quarantined')
          try {
            writeAudit({
              id: randomUUID(), timestamp: Date.now(), taskId: context.taskId,
              workspaceId: context.workspace.id, actor: 'system', action: 'plugin.isolation',
              outcome: 'failure', risk: 'critical', reasonCode: 'PLUGIN_ISOLATED',
              pluginId: item.manifest.id,
              pluginVersion: item.manifest.version
            })
          } catch { /* the failing tool remains isolated */ }
          void import('electron').then(({ BrowserWindow }) => {
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed()) window.webContents.send('plugins:changed')
            }
          }).catch(() => undefined)
        }
      }
    }) : []
    workers.push({ worker, unregister: activeRuntimes.add(item.manifest.id, worker) })
    tools.push(...pluginTools)
    const toolNames = new Set(item.manifest.tools.map((tool) => tool.name))
    item.manifest.hooks.forEach((hook, index) => {
      let name = `hook_${index}`
      while (toolNames.has(name)) name = `hook_${name}`
      toolNames.add(name)
      hookRegistrations.push({
        pluginId: item.manifest.id, version: item.manifest.version, ...hook, name, worker
      })
    })
  }
  const hookController = new PluginHookController(hookRegistrations, {
    succeeded: (registration) => clearPluginFailure(registration.pluginId),
    failed: (failure) => recordHookFailure(failure, writeAudit)
  })
  return {
    tools,
    pluginIds: packages.map((item) => item.manifest.id),
    pluginVersions: versions,
    observe: (event) => hookController.observe(event),
    dispose: async () => {
      await hookController.drain()
      await Promise.all(workers.map(async ({ worker, unregister }) => {
        unregister()
        await worker.stop('task_finished')
      }))
    }
  }
}

export async function stopPluginRuntimes(id: string): Promise<void> {
  await activeRuntimes.stopAll(id, 'plugin_uninstalled')
}

export function resetPluginRuntimeForTests(): void {
  resetPluginHealth()
}

export function recoverPlugin(id: string): void {
  recoverPluginHealth(id)
}

class LazyPluginWorker implements PluginToolWorker {
  private readonly host = new PluginWorkerHost({ workerPath: join(__dirname, 'pluginWorkerProcess.js') })
  private startPromise?: Promise<void>

  constructor(private readonly rootPath: string, private readonly manifest: ParsedPluginManifest) {}

  async invoke(toolName: string, args: unknown, context: { taskId: string; workspaceId: string }, signal?: AbortSignal): Promise<unknown> {
    this.startPromise ??= this.host.start({
      pluginId: this.manifest.id,
      rootPath: this.rootPath,
      tools: workerDefinitions(this.manifest)
    })
    await this.startPromise
    return this.host.invoke(toolName, args, context, signal)
  }

  async stop(reason = 'task_finished'): Promise<void> {
    if (!this.startPromise) return
    await this.host.stop(reason)
  }
}

function workerDefinitions(manifest: ParsedPluginManifest): Array<{ name: string; entryPath: string }> {
  const definitions = manifest.tools.map((tool) => ({ name: tool.name, entryPath: tool.entry }))
  const names = new Set(definitions.map((item) => item.name))
  manifest.hooks.forEach((hook, index) => {
    let name = `hook_${index}`
    while (names.has(name)) name = `hook_${name}`
    names.add(name)
    definitions.push({ name, entryPath: hook.entry })
  })
  return definitions
}

function recordHookFailure(
  failure: { pluginId: string; version?: string; event: string; reasonCode: string; taskId: string; workspaceId: string },
  writeAudit: AuditWriter
): void {
  try {
    writeAudit({
      id: randomUUID(), timestamp: Date.now(), taskId: failure.taskId, workspaceId: failure.workspaceId,
      actor: 'system', action: 'plugin.hook', outcome: 'failure', risk: 'low', reasonCode: failure.reasonCode,
      target: failure.event, pluginId: failure.pluginId, pluginVersion: failure.version
    })
  } catch { /* hook execution is observational */ }
  const wasQuarantined = isPluginQuarantined(failure.pluginId)
  if (recordPluginFailure(failure.pluginId) && !wasQuarantined) {
    void activeRuntimes.stopAll(failure.pluginId, 'plugin_quarantined')
    try {
      writeAudit({
        id: randomUUID(), timestamp: Date.now(), taskId: failure.taskId, workspaceId: failure.workspaceId,
        actor: 'system', action: 'plugin.isolation', outcome: 'failure', risk: 'critical',
        reasonCode: 'PLUGIN_ISOLATED', pluginId: failure.pluginId, pluginVersion: failure.version
      })
    } catch { /* isolation remains effective */ }
    void import('electron').then(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('plugins:changed')
      }
    }).catch(() => undefined)
  }
}
