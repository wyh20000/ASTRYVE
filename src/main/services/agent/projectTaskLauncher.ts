import type { TaskSnapshot, WorkspaceGrant } from '../../../shared/agent'
import type { AgentExecutionCapabilities, AgentProjectPreferences } from '../../../shared/types'
import type { CreateTaskInput } from './taskRuntime'
import { defaultAgentProjectPreferences, validateAgentProjectPreferences } from './projectPreferences'

export interface ProjectTaskDependencies {
  sessionExists: (id: string) => Promise<boolean>
  activeWorkspace: (sessionId: string) => string | undefined
  verifyWorkspace: (id: string) => Promise<void>
  getGrant: (id: string) => WorkspaceGrant | undefined
  getPreferences: (id: string) => AgentProjectPreferences | undefined
  getCapabilities: () => AgentExecutionCapabilities
  ownerAlive: (id: number) => boolean
  createTask: (input: CreateTaskInput) => TaskSnapshot
}

/** Main-process entry point: callers cannot supply permission, environment, or workspace paths. */
export async function launchProjectTask(
  sessionId: string,
  ownerWebContentsId: number,
  dependencies: ProjectTaskDependencies
): Promise<TaskSnapshot> {
  const workspaceId = dependencies.activeWorkspace(sessionId)
  if (!workspaceId) throw new Error('请先选择并授权项目工作区')
  if (!dependencies.ownerAlive(ownerWebContentsId)) throw new Error('任务窗口已关闭')
  await dependencies.verifyWorkspace(workspaceId)
  if (!(await dependencies.sessionExists(sessionId))) throw new Error('会话不存在或已删除')
  // Recheck after all asynchronous work; switching project or closing a window invalidates launch.
  if (dependencies.activeWorkspace(sessionId) !== workspaceId) throw new Error('工作区已切换，请重新发起任务')
  if (!dependencies.ownerAlive(ownerWebContentsId)) throw new Error('任务窗口已关闭')
  const workspace = dependencies.getGrant(workspaceId)
  if (!workspace) throw new Error('工作区授权已失效')
  const capabilities = dependencies.getCapabilities()
  const saved = dependencies.getPreferences(workspaceId) ?? defaultAgentProjectPreferences(workspaceId)
  const preferences = validateAgentProjectPreferences(saved, new Set([workspaceId]), capabilities)
  // Saving a preference is not evidence that a backend exists or is safe to execute.
  if (preferences.executionEnvironment === 'docker' && !capabilities.dockerAvailable) {
    throw new Error(capabilities.dockerReason ?? 'Docker 沙箱不可用，请检查执行环境')
  }
  if (preferences.executionEnvironment === 'local' && !capabilities.localAvailable) {
    throw new Error('本机执行当前不可用')
  }
  return dependencies.createTask({
    sessionId, ownerWebContentsId, workspace: { ...workspace },
    permissionMode: preferences.permissionMode, environment: preferences.executionEnvironment
  })
}
