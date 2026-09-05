import { describe, expect, it, vi } from 'vitest'
import type { ExecutionBackend, ToolExecutionContext } from '../../../shared/agent'
import { createProcessRunTool } from './processRunTool'

const context: ToolExecutionContext = {
  taskId: 'task-1', callId: 'call-1',
  workspace: { id: 'workspace-1', rootPath: 'D:\\repo', realRootPath: 'D:\\repo', createdAt: 1 },
  environment: 'local', permissionMode: 'ask-every-time', signal: new AbortController().signal
}

describe('process.run tool', () => {
  it('has a closed allowlisted schema and invokes the backend with trusted context', async () => {
    const run = vi.fn(async () => ({ exitCode: 0, durationMs: 2, stdout: 'ok', stderr: '', truncated: false }))
    const backend: ExecutionBackend = { environment: 'local', run, stopTask: vi.fn() }
    const tool = createProcessRunTool(backend)
    expect(tool.validateArgs({ executable: 'npm', args: ['test'], timeoutMs: 5000 })).toBe(true)
    expect(tool.validateArgs({ executable: 'cmd', args: ['/c', 'whoami'] })).toBe(false)
    expect(tool.validateArgs({ executable: 'node', args: [], extra: true })).toBe(false)
    await expect(tool.execute({ executable: 'npm', args: ['test'] }, context)).resolves.toMatchObject({ ok: true })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1', workspace: context.workspace, executable: 'npm', args: ['test'], timeoutMs: 120000
    }), context.signal)
  })

  it('fails closed outside the local backend', async () => {
    const backend: ExecutionBackend = { environment: 'local', run: vi.fn(), stopTask: vi.fn() }
    const tool = createProcessRunTool(backend)
    await expect(tool.execute({ executable: 'git', args: ['status'] }, { ...context, environment: 'docker' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'WRONG_EXECUTION_ENVIRONMENT' } })
    expect(backend.run).not.toHaveBeenCalled()
  })
})
