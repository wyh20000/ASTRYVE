import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionRequest } from '../../../shared/agent'
import { DockerExecutionBackend } from './dockerExecutionBackend'

const request: ExecutionRequest = {
  taskId: 'task-1', callId: 'call-1', executable: 'npm', args: ['test'], timeoutMs: 30_000,
  workspace: { id: 'workspace-1', rootPath: path.resolve('fixture'), realRootPath: path.resolve('fixture'), createdAt: 1 }
}

describe('DockerExecutionBackend', () => {
  it('runs only against a filtered temporary copy with hardened argv and cleans everything', async () => {
    const removeCopy = vi.fn(async () => undefined)
    const runCli = vi.fn(async (_exe, args: string[]) => ({
      exitCode: 0, durationMs: 1, stdout: args[0] === 'run' ? 'ok' : '', stderr: '', truncated: false
    }))
    const backend = new DockerExecutionBackend({
      verifyWorkspace: vi.fn(async () => undefined), appendOutput: vi.fn(),
      findExecutable: async () => 'C:\\Docker\\docker.exe',
      createCopy: async () => ({ rootPath: 'C:\\safe-copy', fileCount: 1, totalBytes: 1, skippedEntries: 0 }),
      removeCopy, assertUsage: async () => undefined,
      collectChanges: async () => ({ files: [], added: 0, modified: 0, deleted: 0, truncated: false }), runCli
    })
    await expect(backend.run(request, new AbortController().signal)).resolves.toMatchObject({ exitCode: 0 })
    const runArgs = runCli.mock.calls[0][1]
    expect(runArgs).toEqual(expect.arrayContaining([
      'run', '--network', 'none', '--mount', 'type=bind,src=C:\\safe-copy,dst=/workspace',
      '--read-only', '--cap-drop', 'ALL', '--user', '10001:10001'
    ]))
    expect(runArgs.join(' ')).not.toContain(request.workspace.realRootPath)
    expect(runCli.mock.calls[1][1].slice(0, 3)).toEqual(['rm', '--force', '--volumes'])
    expect(removeCopy).toHaveBeenCalledTimes(1)
  })

  it('cancels the Docker CLI and waits for forced container cleanup', async () => {
    let runSignal: AbortSignal | undefined
    const runCli = vi.fn(async (_exe, args: string[], signal: AbortSignal) => {
      if (args[0] === 'rm') return { exitCode: 0, durationMs: 1, stdout: '', stderr: '', truncated: false }
      runSignal = signal
      return await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('COMMAND_CANCELLED')), { once: true }))
    })
    const backend = new DockerExecutionBackend({
      verifyWorkspace: async () => undefined, appendOutput: vi.fn(), findExecutable: async () => 'docker',
      createCopy: async () => ({ rootPath: 'C:\\safe-copy', fileCount: 0, totalBytes: 0, skippedEntries: 0 }),
      removeCopy: async () => undefined, assertUsage: async () => undefined,
      collectChanges: async () => ({ files: [], added: 0, modified: 0, deleted: 0, truncated: false }), runCli
    })
    const pending = backend.run(request, new AbortController().signal)
    await vi.waitFor(() => expect(runSignal).toBeDefined())
    const stop = backend.stopTask('task-1')
    await expect(pending).rejects.toThrow('COMMAND_CANCELLED')
    await expect(stop).resolves.toBeUndefined()
    expect(runCli.mock.calls.at(-1)?.[1][0]).toBe('rm')
  })

  it('consumes one-command network grants and revokes task grants when the task ends', async () => {
    const networks: string[] = []
    const runCli = vi.fn(async (_exe, args: string[]) => {
      if (args[0] === 'run') networks.push(args[args.indexOf('--network') + 1])
      return { exitCode: 0, durationMs: 1, stdout: '', stderr: '', truncated: false }
    })
    const backend = new DockerExecutionBackend({
      verifyWorkspace: async () => undefined, appendOutput: vi.fn(), findExecutable: async () => 'docker',
      createCopy: async () => ({ rootPath: 'C:\\safe-copy', fileCount: 0, totalBytes: 0, skippedEntries: 0 }),
      removeCopy: async () => undefined, assertUsage: async () => undefined,
      collectChanges: async () => ({ files: [], added: 0, modified: 0, deleted: 0, truncated: false }), runCli
    })
    backend.grantNetwork('task-1', 'once')
    await backend.run(request, new AbortController().signal)
    await backend.run(request, new AbortController().signal)
    backend.grantNetwork('task-1', 'task')
    await backend.run(request, new AbortController().signal)
    await backend.stopTask('task-1')
    await backend.run(request, new AbortController().signal)
    expect(networks).toEqual(['bridge', 'none', 'bridge', 'none'])
  })
})
