import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { ExecutionBackend, ExecutionRequest, ExecutionResult } from '../../../shared/agent'
import { buildHardenedDockerRunArgs } from './dockerCommand'
import { findDockerExecutable } from './dockerPreflight'
import { runDockerCli } from './dockerProcess'
import {
  createDockerWorkspaceCopy,
  collectDockerWorkspaceChanges,
  assertDockerWorkspaceUsage,
  removeDockerWorkspaceCopy,
  type DockerWorkspaceCopy
} from './dockerWorkspaceCopy'
import { LOCAL_EXECUTABLES } from './trustedExecutable'

interface RunningContainer {
  controller: AbortController
  completion: Promise<void>
}

export interface DockerExecutionBackendDependencies {
  verifyWorkspace: (workspaceId: string) => Promise<void>
  appendOutput: (taskId: string, stream: 'stdout' | 'stderr', chunk: string) => void
  runtimeRoot?: string
  findExecutable?: typeof findDockerExecutable
  createCopy?: typeof createDockerWorkspaceCopy
  removeCopy?: typeof removeDockerWorkspaceCopy
  assertUsage?: typeof assertDockerWorkspaceUsage
  collectChanges?: typeof collectDockerWorkspaceChanges
  runCli?: typeof runDockerCli
}

export class DockerExecutionBackend implements ExecutionBackend {
  readonly environment = 'docker' as const
  private readonly running = new Map<string, Set<RunningContainer>>()
  private readonly networkGrants = new Map<string, 'once' | 'task'>()

  constructor(private readonly dependencies: DockerExecutionBackendDependencies) {}

  async run(request: ExecutionRequest, signal: AbortSignal): Promise<ExecutionResult> {
    if (signal.aborted) throw new Error('COMMAND_CANCELLED')
    if (!(LOCAL_EXECUTABLES as readonly string[]).includes(request.executable) ||
        request.args.length > 256 || request.args.some((arg) => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0')) ||
        !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1_000 || request.timeoutMs > 600_000) {
      throw new Error('DOCKER_COMMAND_INVALID')
    }
    await this.dependencies.verifyWorkspace(request.workspace.id)
    const executable = await (this.dependencies.findExecutable ?? findDockerExecutable)()
    if (!executable) throw new Error('DOCKER_CLI_NOT_FOUND')
    const runtimeRoot = this.dependencies.runtimeRoot ?? join(tmpdir(), 'ai-agent-docker-runtime')
    await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
    const copy = await (this.dependencies.createCopy ?? createDockerWorkspaceCopy)(
      request.workspace.realRootPath, runtimeRoot
    )
    try {
      await this.dependencies.verifyWorkspace(request.workspace.id)
    } catch (error) {
      await (this.dependencies.removeCopy ?? removeDockerWorkspaceCopy)(copy).catch(() => undefined)
      throw error
    }
    const containerName = `ai-agent-${randomUUID().replaceAll('-', '').slice(0, 24)}`
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    let settle!: () => void
    const completion = new Promise<void>((resolve) => { settle = resolve })
    const running = { controller, completion }
    this.add(request.taskId, running)
    let workspaceViolation: Error | undefined
    let checkingWorkspace = false
    const assertUsage = this.dependencies.assertUsage ?? assertDockerWorkspaceUsage
    const usageTimer = setInterval(() => {
      if (checkingWorkspace || controller.signal.aborted) return
      checkingWorkspace = true
      void assertUsage(copy.rootPath)
        .catch((error) => {
          workspaceViolation = error instanceof Error ? error : new Error('DOCKER_WORKSPACE_OUTPUT_LIMIT')
          controller.abort('DOCKER_WORKSPACE_OUTPUT_LIMIT')
        })
        .finally(() => { checkingWorkspace = false })
    }, 500)
    try {
      const args = buildHardenedDockerRunArgs({
        containerName, workspacePath: copy.rootPath,
        imageReference: request.dockerImageId,
        executable: request.executable, args: request.args,
        networkEnabled: this.consumeNetworkGrant(request.taskId),
        expiresAt: Date.now() + request.timeoutMs + 60_000
      })
      try {
        const result = await (this.dependencies.runCli ?? runDockerCli)(
          executable, args, controller.signal, request.timeoutMs,
          request.captureOnly ? undefined : (stream, chunk) => this.dependencies.appendOutput(request.taskId, stream, chunk)
        )
        await assertUsage(copy.rootPath)
        const sandboxChanges = await (this.dependencies.collectChanges ?? collectDockerWorkspaceChanges)(copy)
        return { ...result, sandboxChanges }
      } catch (error) {
        throw workspaceViolation ?? error
      }
    } finally {
      clearInterval(usageTimer)
      signal.removeEventListener('abort', abort)
      await this.forceRemove(executable, containerName)
      await (this.dependencies.removeCopy ?? removeDockerWorkspaceCopy)(copy).catch(() => undefined)
      this.remove(request.taskId, running)
      settle()
    }
  }

  async stopTask(taskId: string): Promise<void> {
    this.networkGrants.delete(taskId)
    const containers = [...(this.running.get(taskId) ?? [])]
    for (const running of containers) running.controller.abort('TASK_STOPPED')
    await Promise.all(containers.map((running) => running.completion))
  }

  grantNetwork(taskId: string, scope: 'once' | 'task'): void {
    this.networkGrants.set(taskId, scope)
  }

  private consumeNetworkGrant(taskId: string): boolean {
    const scope = this.networkGrants.get(taskId)
    if (!scope) return false
    if (scope === 'once') this.networkGrants.delete(taskId)
    return true
  }

  private async forceRemove(executable: string, containerName: string): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    try {
      await (this.dependencies.runCli ?? runDockerCli)(
        executable, ['rm', '--force', '--volumes', containerName], controller.signal, 5_000
      )
    } catch { /* A --rm container may already be gone. */ }
    finally { clearTimeout(timeout) }
  }

  private add(taskId: string, running: RunningContainer): void {
    const set = this.running.get(taskId) ?? new Set<RunningContainer>()
    set.add(running)
    this.running.set(taskId, set)
  }

  private remove(taskId: string, running: RunningContainer): void {
    const set = this.running.get(taskId)
    if (!set) return
    set.delete(running)
    if (!set.size) this.running.delete(taskId)
  }
}
