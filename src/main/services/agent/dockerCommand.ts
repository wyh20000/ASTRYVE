export const BUILTIN_DOCKER_IMAGE = 'node:22.14.0-bookworm-slim'
export const DOCKER_RUNNER_USER = '10001:10001'

export interface DockerRunCommandInput {
  containerName: string
  workspacePath: string
  imageReference?: string
  executable: string
  args: string[]
  networkEnabled?: boolean
  expiresAt?: number
}

/**
 * Produces argv only. Callers must pass the result directly to spawn/execFile with shell disabled.
 * Workspace mounts are intentionally absent until the filtered-copy backend is implemented.
 */
export function buildHardenedDockerRunArgs(input: DockerRunCommandInput): string[] {
  if (!/^ai-agent-[a-z0-9][a-z0-9_.-]{0,62}$/.test(input.containerName)) {
    throw new Error('DOCKER_CONTAINER_NAME_INVALID')
  }
  if (input.imageReference !== undefined && input.imageReference !== BUILTIN_DOCKER_IMAGE &&
      !/^sha256:[a-f0-9]{64}$/.test(input.imageReference)) {
    throw new Error('DOCKER_IMAGE_NOT_APPROVED')
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(input.executable)) {
    throw new Error('DOCKER_EXECUTABLE_INVALID')
  }
  if (!/^(?:[a-zA-Z]:[\\/]|\/)/.test(input.workspacePath) || /[\0\r\n,]/.test(input.workspacePath)) {
    throw new Error('DOCKER_WORKSPACE_PATH_INVALID')
  }
  if (input.args.length > 256 || input.args.some((arg) => typeof arg !== 'string' || arg.length > 8192)) {
    throw new Error('DOCKER_ARGUMENTS_INVALID')
  }
  if (input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0)) {
    throw new Error('DOCKER_EXPIRY_INVALID')
  }
  return [
    'run', '--rm', '--init',
    '--name', input.containerName,
    '--label', 'com.ai-agent.managed=true',
    '--label', `com.ai-agent.expires-at=${input.expiresAt ?? Date.now() + 660_000}`,
    // A bind mount is writable by default. Docker's --mount parser does not accept a bare `rw` field.
    '--mount', `type=bind,src=${input.workspacePath},dst=/workspace`,
    '--network', input.networkEnabled ? 'bridge' : 'none',
    '--cpus', '2',
    '--memory', '4g',
    '--pids-limit', '256',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', DOCKER_RUNNER_USER,
    '--hostname', 'ai-agent-sandbox',
    '--env', 'HOME=/tmp/home',
    '--env', 'npm_config_cache=/tmp/npm-cache',
    '--env', 'CI=1',
    '--env', 'NO_COLOR=1',
    '--env', 'GIT_CONFIG_NOSYSTEM=1',
    '--env', 'GIT_CONFIG_GLOBAL=/dev/null',
    '--workdir', '/workspace',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
    '--entrypoint', input.executable,
    input.imageReference ?? BUILTIN_DOCKER_IMAGE,
    ...input.args
  ]
}
