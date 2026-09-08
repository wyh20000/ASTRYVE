import { join } from 'node:path'
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

export async function createProjectTask(sessionId: string, ownerWebContentsId: number) {
  const [{ BrowserWindow }, { getStore }, settings, workspaces] = await Promise.all([
    import('electron'), import('../../db'), import('../settings'), import('./workspaceManager')
  ])
  const capabilities = await refreshAgentExecutionCapabilities()
  return launchProjectTask(sessionId, ownerWebContentsId, {
    sessionExists: async (id) => Boolean(await getStore().getSession(id)),
    activeWorkspace: workspaces.getSessionWorkspaceId,
    verifyWorkspace: async (id) => { await workspaces.getWorkspaceService().activate(id) },
    getGrant: (id) => workspaces.getWorkspaceService().getGrant(id),
    getPreferences: settings.getAgentProjectPreferences,
    getCapabilities: () => capabilities,
    ownerAlive: (id) => BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.webContents.id === id),
    createTask: (input) => getTaskRuntime().createTask(input)
  })
}

let registry: ToolRegistry | null = null
let runtime: TaskRuntime | null = null
let journal: TaskEventJournal | null = null
let unsubscribeJournal: (() => void) | null = null
let auditJournal: AuditJournal | null = null
let patchWorkspace: PatchWorkspaceService | null = null

export function initTaskRuntime(): TaskRuntime {
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
    new DenyFirstPolicyEngine(writeAudit)
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

export function getPatchWorkspaceService(): PatchWorkspaceService {
  if (!patchWorkspace) throw new Error('Patch workspace service not initialized')
  return patchWorkspace
}

export function writeAgentAudit(event: import('../../../shared/agent').AuditEvent): void {
  if (!auditJournal) throw new Error('审计日志尚未初始化')
  auditJournal.write(event)
}

/** Coding tools are opt-in per project. Unavailable Docker preferences keep ordinary chat working. */
export function shouldUseProjectAgent(sessionId: string): boolean {
  const workspaceId = getSessionWorkspaceId(sessionId)
  return Boolean(workspaceId)
}

export function cancelTasksForSession(sessionId: string, reason: string): number {
  return runtime?.cancelSession(sessionId, reason) ?? 0
}

export function cancelTasksForOwner(ownerWebContentsId: number, reason: string): number {
  return runtime?.cancelOwner(ownerWebContentsId, reason) ?? 0
}

export function cancelAllAgentTasks(reason: string): number {
  return runtime?.cancelAll(reason) ?? 0
}

export async function flushTaskPersistence(): Promise<void> {
  await journal?.close()
}

export function resetTaskRuntimeForTests(): void {
  unsubscribeJournal?.()
  unsubscribeJournal = null
  void journal?.close()
  journal = null
  runtime?.cancelAll('test_reset')
  runtime = null
  registry = null
  auditJournal = null
  patchWorkspace = null
}
