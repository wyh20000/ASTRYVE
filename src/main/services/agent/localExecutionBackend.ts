import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import type { ExecutionBackend, ExecutionRequest, ExecutionResult } from '../../../shared/agent'
import { executeInUtilityProcess } from './localExecutionProcess'
import { LOCAL_EXECUTABLES, resolveTrustedExecutable, type LocalExecutableName } from './trustedExecutable'

export interface LocalExecutionBackendDependencies {
  verifyWorkspace: (workspaceId: string) => Promise<void>
  appendOutput: (taskId: string, stream: 'stdout' | 'stderr', chunk: string) => void
  resolveExecutable?: typeof resolveTrustedExecutable
  execute?: typeof executeInUtilityProcess
}

/** Main-process adapter. Every run is isolated in its own utility process. */
export class LocalExecutionBackend implements ExecutionBackend {
  readonly environment = 'local' as const
  private readonly running = new Map<string, Set<AbortController>>()

  constructor(private readonly dependencies: LocalExecutionBackendDependencies) {}

  async run(request: ExecutionRequest, signal: AbortSignal): Promise<ExecutionResult> {
    if (signal.aborted) throw new Error('COMMAND_CANCELLED')
    if (!(LOCAL_EXECUTABLES as readonly string[]).includes(request.executable)) {
      throw new Error('EXECUTABLE_NOT_ALLOWED')
    }
    // Revalidate the persisted grant immediately before crossing the execution boundary.
    await this.dependencies.verifyWorkspace(request.workspace.id)
    if (signal.aborted) throw new Error('COMMAND_CANCELLED')

    const resolveExecutable = this.dependencies.resolveExecutable ?? resolveTrustedExecutable
    const resolved = await resolveExecutable(request.executable as LocalExecutableName)
    const controller = new AbortController()
    const runtimeHome = await mkdtemp(join(tmpdir(), 'ai-agent-task-'))
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    this.add(request.taskId, controller)
    try {
      const execute = this.dependencies.execute ?? executeInUtilityProcess
      return await execute({
        executable: resolved.executable,
        args: [
          ...resolved.prefixArgs,
          ...(request.executable === 'git' ? ['-c', `safe.directory=${request.workspace.realRootPath}`] : []),
          ...request.args
        ],
        cwd: request.workspace.realRootPath,
        env: minimalEnvironment(request.workspace.realRootPath, resolved.trustedPathEntries, runtimeHome),
        timeoutMs: request.timeoutMs
      }, controller.signal, (stream, chunk) => {
        if (request.captureOnly) return
        try { this.dependencies.appendOutput(request.taskId, stream, chunk) } catch {
          controller.abort('TASK_OUTPUT_UNAVAILABLE')
        }
      })
    } finally {
      signal.removeEventListener('abort', abort)
      this.remove(request.taskId, controller)
      await rm(runtimeHome, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async stopTask(taskId: string): Promise<void> {
    for (const controller of this.running.get(taskId) ?? []) controller.abort('TASK_STOPPED')
  }

  private add(taskId: string, controller: AbortController): void {
    const controllers = this.running.get(taskId) ?? new Set<AbortController>()
    controllers.add(controller)
    this.running.set(taskId, controllers)
  }

  private remove(taskId: string, controller: AbortController): void {
    const controllers = this.running.get(taskId)
    if (!controllers) return
    controllers.delete(controller)
    if (controllers.size === 0) this.running.delete(taskId)
  }
}

function minimalEnvironment(workspaceRoot: string, trustedPathEntries: string[], runtimeHome: string): Record<string, string> {
  const systemRoot = process.env.SYSTEMROOT ?? process.env.WINDIR
  const pathEntries = [
    join(workspaceRoot, 'node_modules', '.bin'),
    ...trustedPathEntries,
    ...(systemRoot ? [join(systemRoot, 'System32')] : [])
  ]
  const env: Record<string, string> = {
    PATH: [...new Set(pathEntries)].join(delimiter),
    TEMP: runtimeHome,
    TMP: runtimeHome,
    HOME: runtimeHome,
    USERPROFILE: runtimeHome,
    APPDATA: runtimeHome,
    LOCALAPPDATA: runtimeHome,
    CI: '1',
    NO_COLOR: '1',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
    PAGER: 'cat'
  }
  if (systemRoot) {
    env.SYSTEMROOT = systemRoot
    env.WINDIR = systemRoot
  }
  return env
}
