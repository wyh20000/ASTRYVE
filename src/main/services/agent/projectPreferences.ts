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
import { runDockerPreflight } from './dockerPreflight'

export const AGENT_EXECUTION_CAPABILITIES: AgentExecutionCapabilities = {
  dockerAvailable: false,
  dockerReason: '正在检测 Docker 沙箱环境',
  localAvailable: true
}

let dockerPreflightPromise: Promise<AgentExecutionCapabilities> | undefined
let dockerPreflightExpiresAt = 0

/** Preflight is cached briefly so opening multiple project menus does not repeatedly query the daemon. */
export function refreshAgentExecutionCapabilities(force = false): Promise<AgentExecutionCapabilities> {
  if (!force && dockerPreflightPromise && Date.now() < dockerPreflightExpiresAt) return dockerPreflightPromise
  dockerPreflightExpiresAt = Date.now() + 30_000
  dockerPreflightPromise = runDockerPreflight().then((dockerPreflight) => {
    Object.assign(AGENT_EXECUTION_CAPABILITIES, {
      dockerAvailable: dockerPreflight.ready,
      dockerReason: dockerPreflight.ready ? undefined : dockerPreflight.reason,
      dockerPreflight,
      dockerImages: dockerPreflight.images,
      localAvailable: true
    } satisfies AgentExecutionCapabilities)
    return {
      ...AGENT_EXECUTION_CAPABILITIES,
      dockerImages: dockerPreflight.images.map((image) => ({ ...image })),
      dockerPreflight: { ...dockerPreflight, images: dockerPreflight.images.map((image) => ({ ...image })) }
    }
  }).catch((error) => {
    AGENT_EXECUTION_CAPABILITIES.dockerAvailable = false
    AGENT_EXECUTION_CAPABILITIES.dockerReason = `Docker 检测失败：${error instanceof Error ? error.message : String(error)}`
    return { ...AGENT_EXECUTION_CAPABILITIES }
  })
  return dockerPreflightPromise
}

export function defaultAgentProjectPreferences(
  workspaceId: string,
  _capabilities: AgentExecutionCapabilities = AGENT_EXECUTION_CAPABILITIES
): AgentProjectPreferences {
  return {
    workspaceId,
    permissionMode: 'ask-every-time',
    executionEnvironment: 'docker',
    dockerImageId: defaultDockerImageId(_capabilities)
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
  const dockerImageId = candidate.dockerImageId
  if (dockerImageId !== undefined && !/^sha256:[a-f0-9]{64}$/i.test(dockerImageId)) {
    throw new Error('Docker 镜像标识无效')
  }
  if (candidate.executionEnvironment === 'docker' && dockerImageId &&
      !(capabilities.dockerImages ?? []).some((image) => image.imageId === dockerImageId)) {
    throw new Error('所选 Docker 镜像已不存在，请重新选择')
  }
  return {
    workspaceId: candidate.workspaceId,
    permissionMode: candidate.permissionMode as PermissionMode,
    executionEnvironment: candidate.executionEnvironment as ExecutionEnvironment,
    dockerImageId: dockerImageId ?? (candidate.executionEnvironment === 'docker'
      ? defaultDockerImageId(capabilities) : undefined)
  }
}

function defaultDockerImageId(capabilities: AgentExecutionCapabilities): string | undefined {
  return capabilities.dockerImages?.find((image) =>
    image.repository === 'node' && image.tag === '22.14.0-bookworm-slim'
  )?.imageId ?? capabilities.dockerImages?.[0]?.imageId
}
