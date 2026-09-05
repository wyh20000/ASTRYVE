import {
  EXECUTION_ENVIRONMENTS,
  PERMISSION_MODES,
  type ExecutionEnvironment,
  type PermissionMode
} from '../../../shared/agent'
import type {
  AgentExecutionCapabilities,
  AgentProjectPreferences
} from '../../../shared/types'

export const AGENT_EXECUTION_CAPABILITIES: AgentExecutionCapabilities = {
  dockerAvailable: false,
  dockerReason: 'Docker 沙箱执行后端尚未启用',
  localAvailable: true
}

export function defaultAgentProjectPreferences(
  workspaceId: string,
  _capabilities: AgentExecutionCapabilities = AGENT_EXECUTION_CAPABILITIES
): AgentProjectPreferences {
  return {
    workspaceId,
    permissionMode: 'ask-every-time',
    executionEnvironment: 'docker'
  }
}

export function validateAgentProjectPreferences(
  value: unknown,
  authorizedWorkspaceIds: ReadonlySet<string>,
  capabilities: AgentExecutionCapabilities = AGENT_EXECUTION_CAPABILITIES,
  current?: AgentProjectPreferences
): AgentProjectPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Agent 配置无效')
  }
  const candidate = value as Partial<AgentProjectPreferences>
  if (
    typeof candidate.workspaceId !== 'string' ||
    !authorizedWorkspaceIds.has(candidate.workspaceId)
  ) {
    throw new Error('项目工作区不存在或未授权')
  }
  if (!(PERMISSION_MODES as readonly unknown[]).includes(candidate.permissionMode)) {
    throw new Error('权限档位无效')
  }
  if (
    !(EXECUTION_ENVIRONMENTS as readonly unknown[]).includes(candidate.executionEnvironment)
  ) {
    throw new Error('执行环境无效')
  }
  // An unavailable Docker preference is safe to retain; execution must check availability.
  // This permits permission changes without silently downgrading the selected backend.
  if (candidate.executionEnvironment === 'local' && !capabilities.localAvailable &&
      !(current?.workspaceId === candidate.workspaceId && current.executionEnvironment === 'local')) {
    throw new Error('本机执行当前不可用')
  }
  return {
    workspaceId: candidate.workspaceId,
    permissionMode: candidate.permissionMode as PermissionMode,
    executionEnvironment: candidate.executionEnvironment as ExecutionEnvironment
  }
}
