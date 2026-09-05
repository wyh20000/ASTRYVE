import { describe, expect, it, vi } from 'vitest'
import type { ExecutionRequest } from '../../../shared/agent'
import { LocalExecutionBackend } from './localExecutionBackend'

const request: ExecutionRequest = {
  taskId: 'task-1', callId: 'call-1',
  workspace: { id: 'workspace-1', rootPath: 'D:\\repo', realRootPath: 'D:\\repo', createdAt: 1 },
  executable: 'node', args: ['--version'], timeoutMs: 5000
}

describe('LocalExecutionBackend', () => {
  it('revalidates the workspace, resolves an allowlisted binary and builds a minimal environment', async () => {
    const order: string[] = []
    const execute = vi.fn(async (command) => {
      order.push('execute')
      expect(command).toMatchObject({
        executable: 'C:\\Runtime\\node.exe', args: ['--version'], cwd: 'D:\\repo', timeoutMs: 5000,
        env: { CI: '1', NO_COLOR: '1' }
      })
      expect(command.env.PATH).toContain('D:\\repo\\node_modules\\.bin')
      expect(command.env).not.toHaveProperty('API_KEY')
      return { exitCode: 0, durationMs: 1, stdout: 'v1', stderr: '', truncated: false }
    })
    const backend = new LocalExecutionBackend({
      verifyWorkspace: async () => { order.push('verify') },
      appendOutput: vi.fn(),
      resolveExecutable: async () => {
        order.push('resolve')
        return { executable: 'C:\\Runtime\\node.exe', prefixArgs: [], trustedPathEntries: ['C:\\Runtime'] }
      },
      execute
    })
    await expect(backend.run(request, new AbortController().signal)).resolves.toMatchObject({ exitCode: 0 })
    expect(order).toEqual(['verify', 'resolve', 'execute'])
  })

  it('rejects non-allowlisted model paths before workspace or process access', async () => {
    const verifyWorkspace = vi.fn()
    const backend = new LocalExecutionBackend({ verifyWorkspace, appendOutput: vi.fn() })
    await expect(backend.run({ ...request, executable: 'C:\\evil.exe' }, new AbortController().signal))
      .rejects.toThrow('EXECUTABLE_NOT_ALLOWED')
    expect(verifyWorkspace).not.toHaveBeenCalled()
  })

  it('stops every active run for a task', async () => {
    let executionSignal: AbortSignal | undefined
    const backend = new LocalExecutionBackend({
      verifyWorkspace: async () => undefined,
      appendOutput: vi.fn(),
      resolveExecutable: async () => ({ executable: 'C:\\Runtime\\node.exe', prefixArgs: [], trustedPathEntries: [] }),
      execute: async (_command, signal) => {
        executionSignal = signal
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('COMMAND_CANCELLED')), { once: true }))
        throw new Error('unreachable')
      }
    })
    const running = backend.run(request, new AbortController().signal)
    await vi.waitFor(() => expect(executionSignal).toBeDefined())
    await backend.stopTask(request.taskId)
    await expect(running).rejects.toThrow('COMMAND_CANCELLED')
    expect(executionSignal?.aborted).toBe(true)
  })
})
