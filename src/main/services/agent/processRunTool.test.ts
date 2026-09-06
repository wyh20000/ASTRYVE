import { describe, expect, it, vi } from 'vitest'
import type { ExecutionBackend, ServiceExecutionBackend, ToolExecutionContext } from '../../../shared/agent'
import { createProcessRunTool, createProcessTools } from './processRunTool'

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

  it('starts and stops only task-scoped services with structured metadata', async () => {
    const startService = vi.fn(async () => ({
      serviceId: 'service-1', pid: 4321, expectedPorts: [5173], startedAt: 1
    }))
    const stopService = vi.fn(async () => true)
    const backend: ServiceExecutionBackend = {
      environment: 'local', run: vi.fn(), stopTask: vi.fn(), startService, stopService
    }
    const [, start, stop] = createProcessTools(backend)
    const args = { executable: 'npm', args: ['run', 'dev'], expectedPorts: [5173] }
    expect(start.validateArgs(args)).toBe(true)
    expect(start.validateArgs({ ...args, expectedPorts: [70000] })).toBe(false)
    await expect(start.execute(args, context)).resolves.toMatchObject({
      ok: true, value: { serviceId: 'service-1', pid: 4321, expectedPorts: [5173] }
    })
    expect(startService).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1', executable: 'npm', expectedPorts: [5173]
    }), context.signal)
    await expect(stop.execute({ serviceId: 'service-1' }, context)).resolves.toEqual({
      ok: true, value: { serviceId: 'service-1', stopped: true }
    })
    expect(stopService).toHaveBeenCalledWith('task-1', 'service-1')
  })

  it('routes ordinary commands to Docker only when Docker was explicitly selected', async () => {
    const localRun = vi.fn()
    const dockerRun = vi.fn(async () => ({ exitCode: 0, durationMs: 1, stdout: 'sandbox', stderr: '', truncated: false }))
    const local: ServiceExecutionBackend = {
      environment: 'local', run: localRun, stopTask: vi.fn(), startService: vi.fn(), stopService: vi.fn()
    }
    const docker: ExecutionBackend = { environment: 'docker', run: dockerRun, stopTask: vi.fn() }
    const [run, start, stop] = createProcessTools(local, docker)
    const dockerContext = { ...context, environment: 'docker' as const }
    await expect(run.execute({ executable: 'npm', args: ['test'] }, dockerContext))
      .resolves.toMatchObject({ ok: true, value: { stdout: 'sandbox' } })
    expect(dockerRun).toHaveBeenCalledOnce()
    expect(localRun).not.toHaveBeenCalled()
    await expect(start.execute({ executable: 'npm', args: ['run', 'dev'] }, dockerContext))
      .resolves.toMatchObject({ ok: false, error: { code: 'WRONG_EXECUTION_ENVIRONMENT' } })
    await expect(stop.execute({ serviceId: 'service-1' }, dockerContext))
      .resolves.toMatchObject({ ok: false, error: { code: 'WRONG_EXECUTION_ENVIRONMENT' } })
  })
})
