import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { TaskRuntime } from './taskRuntime'
import { ToolRegistry } from './toolRegistry'
import { FileTaskEventStore, TaskEventJournal } from './taskEventJournal'
import { cleanupStaleTaskResources } from './taskRecovery'
import { ToolAuthorization } from './toolAuthorization'
import { createApprovalDialog } from './approvalDialog'
import { TERMINAL_TASK_STATUSES } from '../../../shared/agent'
import { launchProjectTask } from './projectTaskLauncher'
import { AuditJournal } from './auditJournal'
import { BoundApprovalService } from './approvalService'
import { DenyFirstPolicyEngine, type AuditWriter } from './policyEngine'
import { LocalExecutionBackend } from './localExecutionBackend'
import { createProcessTools } from './processRunTool'
import { getWorkspaceService } from './workspaceManager'
import { getSessionWorkspaceId } from './workspaceManager'
import { createWorkspaceReadTools } from './workspaceReadTools'
import { createGitReadTools } from './gitReadTools'
import { DockerExecutionBackend } from './dockerExecutionBackend'
import { createDockerNetworkTool } from './dockerNetworkTool'
import { PatchWorkspaceService } from './patchWorkspaceService'
import { createWorkspacePatchTool } from './workspacePatchTool'
import { createHostPatchTool } from './hostPatchTool'
import { createScriptDiscoveryTool } from './scriptDiscoveryTool'
import { refreshAgentExecutionCapabilities } from './projectPreferences'
import { capturePluginTaskTools } from './pluginManager'
import { isWorkSessionForWorkspace } from './sessionScope'
import { captureTaskPluginCapabilities } from './pluginMcpTools'
import { createInstalledPluginConnectionManager } from './pluginMcpRuntime'
import type { PluginConnectionManager } from './pluginConnectionManager'
import { getBrowserPreferences } from '../settings'
import { createBrowserTools } from '../browser/browserTools'
import type { BrowserGateway } from '../browser/browserGateway'
import { BrowserCapability } from '../browser/browserCapability'
import { acquireOfficialChromeBrowserLease, getOfficialChromeBrowserGeneration } from '../browser/officialChromeBrowserRuntime'

export async function createProjectTask(sessionId: string, ownerWebContentsId: number, pluginIds?: readonly string[]) {
  const [{ BrowserWindow }, { getStore }, settings, workspaces] = await Promise.all([
    import('electron'), import('../../db'), import('../settings'), import('./workspaceManager')
  ])
  const session = await getStore().getSession(sessionId)
  if (!session || session.kind !== 'work' || !session.projectPath) {
    throw new Error('仅已绑定项目的工作会话可使用 Coding')
  }
  const binding = workspaces.getSessionWorkspaceId(sessionId)
  const grant = binding ? workspaces.getWorkspaceService().getGrant(binding) : undefined
  if (!binding || !isWorkSessionForWorkspace(session, grant, binding)) {
    throw new Error('项目授权已失效，请重新打开原项目')
  }
  const capabilities = await refreshAgentExecutionCapabilities()
  const localPluginSnapshot = await capturePluginTaskTools(pluginIds, undefined, writeAgentAudit)
  const pluginSnapshot = pluginConnectionManager
    ? await captureTaskPluginCapabilities(localPluginSnapshot, pluginConnectionManager, writeAgentAudit)
    : localPluginSnapshot
  try {
    const task = await launchProjectTask(sessionId, ownerWebContentsId, {
      sessionExists: async (id) => Boolean(await getStore().getSession(id)),
      activeWorkspace: workspaces.getSessionWorkspaceId,
      verifyWorkspace: async (id) => { await workspaces.getWorkspaceService().activate(id) },
      getGrant: (id) => workspaces.getWorkspaceService().getGrant(id),
      getPreferences: settings.getAgentProjectPreferences,
      getCapabilities: () => capabilities,
      ownerAlive: (id) => BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.webContents.id === id),
      createTask: (input) => getTaskRuntime().createTask({
        ...input,
        toolDefinitions: pluginSnapshot.tools,
        pluginIds: pluginSnapshot.pluginIds,
        pluginVersions: pluginSnapshot.pluginVersions,
        observe: pluginSnapshot.observe,
        dispose: pluginSnapshot.dispose
      })
    })
    return { ...task, capabilityToolNames: pluginSnapshot.tools.map((tool) => tool.name) }
  } catch (error) {
    await pluginSnapshot.dispose().catch(() => undefined)
    throw error
  }
}

/** Starts a browser-only tool task without requiring the user to attach a project workspace. */
export async function createBrowserTask(sessionId: string, ownerWebContentsId: number) {
  return createCapabilityTask(sessionId, ownerWebContentsId)
}

/** A reply-scoped tool task that does not require a user-granted project workspace. */
export async function createCapabilityTask(
  sessionId: string,
  ownerWebContentsId: number,
  pluginIds?: readonly string[]
) {
  const [{ BrowserWindow }, { getStore }] = await Promise.all([
    import('electron'), import('../../db')
  ])
  if (!(await getStore().getSession(sessionId))) throw new Error('会话不存在或已删除')
  if (!BrowserWindow.getAllWindows().some((window) =>
    !window.isDestroyed() && window.webContents.id === ownerWebContentsId)) {
    throw new Error('任务窗口已关闭')
  }
  const localPluginSnapshot = pluginIds?.length
    ? await capturePluginTaskTools(pluginIds, undefined, writeAgentAudit, false)
    : null
  const pluginSnapshot = localPluginSnapshot && pluginConnectionManager
    ? await captureTaskPluginCapabilities(localPluginSnapshot, pluginConnectionManager, writeAgentAudit)
    : localPluginSnapshot
  let runtimeRoot: string | undefined
  try {
    runtimeRoot = await mkdtemp(join(tmpdir(), 'astryve-capability-'))
    const isolatedRoot = runtimeRoot
    const dispose = async (): Promise<void> => {
      const results = await Promise.allSettled([
        pluginSnapshot?.dispose(),
        rm(isolatedRoot, { recursive: true, force: true })
      ])
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) throw failed.reason
    }
    const task = getTaskRuntime().createTask({
      sessionId,
      ownerWebContentsId,
      // Runtime tool contexts require a grant shape. This isolated empty root
      // never points at app data or a user project; callers expose only
      // selected capability tools, never workspace/process/git definitions.
      workspace: {
        id: `capability:${sessionId}`,
        rootPath: isolatedRoot,
        realRootPath: isolatedRoot,
        createdAt: Date.now()
      },
      permissionMode: 'ask-every-time',
      environment: 'local',
      toolDefinitions: pluginSnapshot?.tools,
      pluginIds: pluginSnapshot?.pluginIds,
      pluginVersions: pluginSnapshot?.pluginVersions,
      observe: pluginSnapshot?.observe,
      dispose
    })
    return { ...task, capabilityToolNames: pluginSnapshot?.tools.map((tool) => tool.name) ?? [] }
  } catch (error) {
    await pluginSnapshot?.dispose().catch(() => undefined)
    if (runtimeRoot) await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

let registry: ToolRegistry | null = null
let runtime: TaskRuntime | null = null
let journal: TaskEventJournal | null = null
let unsubscribeJournal: (() => void) | null = null
let auditJournal: AuditJournal | null = null
let patchWorkspace: PatchWorkspaceService | null = null
let pluginConnectionManager: PluginConnectionManager | null = null
let browserCapability: BrowserCapability | null = null

export function initTaskRuntime(browserGateway?: BrowserGateway): TaskRuntime {
  void browserCapability?.releaseAll()
  browserCapability = null
  unsubscribeJournal?.()
  unsubscribeJournal = null
  journal = null
  auditJournal = null
  const writeAudit: AuditWriter = (event) => {
    if (!auditJournal) throw new Error('审计日志尚未初始化，操作已阻止')
    auditJournal.write(event)
  }
  const authorization = new ToolAuthorization(
    createApprovalDialog((id) => runtime?.getTaskSnapshot(id)),
    (id, waiting) => runtime?.setWaitingApproval(id, waiting),
    new BoundApprovalService(writeAudit),
    new DenyFirstPolicyEngine(writeAudit, Date.now, getBrowserPreferences)
  )
  registry = new ToolRegistry((invocation, context, definition) => authorization.authorize(invocation, context, definition))
  runtime = new TaskRuntime(registry)
  const localBackend = new LocalExecutionBackend({
    verifyWorkspace: async (workspaceId) => { await getWorkspaceService().activate(workspaceId) },
    appendOutput: (taskId, stream, chunk) => {
      if (runtime?.getTaskSnapshot(taskId)) runtime.appendOutput(taskId, stream, chunk)
    }
  })
  const dockerBackend = new DockerExecutionBackend({
    verifyWorkspace: async (workspaceId) => { await getWorkspaceService().activate(workspaceId) },
    appendOutput: (taskId, stream, chunk) => {
      if (runtime?.getTaskSnapshot(taskId)) runtime.appendOutput(taskId, stream, chunk)
    }
  })
  for (const tool of createProcessTools(localBackend, dockerBackend)) registry.register(tool)
  registry.register(createDockerNetworkTool(dockerBackend))
  for (const tool of createWorkspaceReadTools(getWorkspaceService)) registry.register(tool)
  registry.register(createScriptDiscoveryTool(getWorkspaceService))
  patchWorkspace = new PatchWorkspaceService(getWorkspaceService)
  registry.register(createWorkspacePatchTool(patchWorkspace))
  registry.register(createHostPatchTool(patchWorkspace))
  for (const tool of createGitReadTools(localBackend)) registry.register(tool)
  if (browserGateway) {
    for (const tool of createBrowserTools(browserGateway)) registry.register(tool)
    browserCapability = new BrowserCapability(browserGateway, acquireOfficialChromeBrowserLease, writeAudit,
      getOfficialChromeBrowserGeneration)
    registry.register(browserCapability.tool())
  }
  runtime.subscribe((event) => {
    const status = runtime?.getTaskSnapshot(event.taskId)?.status
    if (status && (TERMINAL_TASK_STATUSES as readonly string[]).includes(status)) {
      authorization.revokeTask(event.taskId)
      // A completed task may leave a patch waiting for approval in the next user message.
      // Failed/cancelled tasks must not retain their overlays.
      if (status !== 'completed') patchWorkspace?.clearTask(event.taskId)
      void localBackend.stopTask(event.taskId)
      void dockerBackend.stopTask(event.taskId)
    }
  })
  return runtime
}

export async function initTaskPersistence(userDataPath: string): Promise<{
  staleTasks: number
  removedResources: number
  removedInterruptedWrites: number
}> {
  const activeRuntime = getTaskRuntime()
  patchWorkspace?.setRuntimeRoot(join(userDataPath, 'agent-runtime', 'tasks'))
  auditJournal = new AuditJournal(join(userDataPath, 'agent-audit.json'))
  await pluginConnectionManager?.close()
  pluginConnectionManager = createInstalledPluginConnectionManager(userDataPath)
  const store = new FileTaskEventStore(join(userDataPath, 'agent-task-journal.json'))
  const removedInterruptedWrites = await store.cleanupInterruptedWrites()
  const staleTaskIds = await store.recoverStaleTasks()
  const removedResources = await cleanupStaleTaskResources(
    join(userDataPath, 'agent-runtime', 'tasks'),
    staleTaskIds
  )
  journal = new TaskEventJournal(store)
  unsubscribeJournal?.()
  unsubscribeJournal = activeRuntime.subscribe((event) => journal?.record(event))
  return { staleTasks: staleTaskIds.length, removedResources, removedInterruptedWrites }
}

export function getTaskRuntime(): TaskRuntime {
  if (!runtime) throw new Error('Task runtime not initialized')
  return runtime
}

export function getToolRegistry(): ToolRegistry {
  if (!registry) throw new Error('Tool registry not initialized')
  return registry
}

export function getBrowserCapability(): BrowserCapability | null { return browserCapability }

export function getPluginConnectionManager(): PluginConnectionManager {
  if (!pluginConnectionManager) throw new Error('插件连接服务尚未初始化')
  return pluginConnectionManager
}

export function getPatchWorkspaceService(): PatchWorkspaceService {
  if (!patchWorkspace) throw new Error('Patch workspace service not initialized')
  return patchWorkspace
}

export function writeAgentAudit(event: import('../../../shared/agent').AuditEvent): void {
  if (!auditJournal) throw new Error('审计日志尚未初始化')
  auditJournal.write(event)
}

export function clearAgentAudit(): void {
  if (!auditJournal) throw new Error('审计日志尚未初始化')
  auditJournal.clear()
}

export function listAgentAudit(): import('../../../shared/agent').AuditEvent[] {
  if (!auditJournal) throw new Error('审计日志尚未初始化')
  return auditJournal.list()
}

/** Coding tools are opt-in per project. Unavailable Docker preferences keep ordinary chat working. */
export function shouldUseProjectAgent(sessionId: string): boolean {
  const workspaceId = getSessionWorkspaceId(sessionId)
  return Boolean(workspaceId)
}

export function cancelTasksForSession(sessionId: string, reason: string): number {
  return runtime?.cancelSession(sessionId, reason) ?? 0
}

export function cancelTasksForWorkspace(workspaceId: string, reason: string): number {
  return runtime?.cancelWorkspace(workspaceId, reason) ?? 0
}

export function cancelTasksForOwner(ownerWebContentsId: number, reason: string): number {
  return runtime?.cancelOwner(ownerWebContentsId, reason) ?? 0
}

export function cancelAllAgentTasks(reason: string): number {
  return runtime?.cancelAll(reason) ?? 0
}

export async function flushTaskPersistence(): Promise<void> {
  await runtime?.settleDisposals()
  await Promise.all([journal?.close(), pluginConnectionManager?.close()])
}

export function resetTaskRuntimeForTests(): void {
  void browserCapability?.releaseAll()
  browserCapability = null
  unsubscribeJournal?.()
  unsubscribeJournal = null
  void journal?.close()
  journal = null
  runtime?.cancelAll('test_reset')
  runtime = null
  registry = null
  auditJournal = null
  patchWorkspace = null
  void pluginConnectionManager?.close()
  pluginConnectionManager = null
}
