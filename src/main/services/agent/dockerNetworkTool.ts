import type { ToolDefinition } from '../../../shared/agent'
import type { DockerExecutionBackend } from './dockerExecutionBackend'

interface DockerNetworkArgs {
  url: string
  scope: 'once' | 'task'
}

export function createDockerNetworkTool(
  backend: Pick<DockerExecutionBackend, 'grantNetwork'>
): ToolDefinition<DockerNetworkArgs, unknown> {
  return {
    name: 'docker.enableNetwork',
    operation: 'network.enable',
    description: 'Request explicit approval to give the Docker sandbox ordinary outbound network access for the next command or the rest of this task. This is not a domain-level firewall; the URL is shown as the stated reason for access.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', maxLength: 2048 },
        scope: { type: 'string', enum: ['once', 'task'] }
      },
      required: ['url', 'scope'],
      additionalProperties: false
    },
    validateArgs: isDockerNetworkArgs,
    execute: async (input, context) => {
      if (context.environment !== 'docker') {
        return { ok: false, error: { code: 'WRONG_EXECUTION_ENVIRONMENT', message: '联网授权只适用于 Docker 沙箱' } }
      }
      backend.grantNetwork(context.taskId, input.scope)
      return { ok: true, value: { enabled: true, scope: input.scope, requestedHost: new URL(input.url).host.toLowerCase() } }
    }
  }
}

function isDockerNetworkArgs(value: unknown): value is DockerNetworkArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  if (!Object.keys(input).every((key) => key === 'url' || key === 'scope') ||
      (input.scope !== 'once' && input.scope !== 'task') || typeof input.url !== 'string' || input.url.length > 2048) return false
  try {
    const url = new URL(input.url)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.host)
  } catch { return false }
}
