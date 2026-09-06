import { describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext } from '../../../shared/agent'
import { createDockerNetworkTool } from './dockerNetworkTool'

const context: ToolExecutionContext = {
  taskId: 'task-1', callId: 'call-1', environment: 'docker', permissionMode: 'ask-every-time',
  workspace: { id: 'workspace-1', rootPath: 'D:\\repo', realRootPath: 'D:\\repo', createdAt: 1 },
  signal: new AbortController().signal
}

describe('Docker network tool', () => {
  it('validates HTTP(S), binds the requested scope and grants only after tool execution', async () => {
    const grantNetwork = vi.fn()
    const tool = createDockerNetworkTool({ grantNetwork })
    expect(tool.validateArgs({ url: 'https://registry.npmjs.org/pkg', scope: 'once' })).toBe(true)
    expect(tool.validateArgs({ url: 'file:///etc/passwd', scope: 'once' })).toBe(false)
    expect(tool.validateArgs({ url: 'https://example.com', scope: 'forever' })).toBe(false)
    await expect(tool.execute({ url: 'https://registry.npmjs.org/pkg', scope: 'task' }, context))
      .resolves.toMatchObject({ ok: true, value: { scope: 'task', requestedHost: 'registry.npmjs.org' } })
    expect(grantNetwork).toHaveBeenCalledWith('task-1', 'task')
  })

  it('cannot grant network to local execution', async () => {
    const grantNetwork = vi.fn()
    const tool = createDockerNetworkTool({ grantNetwork })
    await expect(tool.execute({ url: 'https://example.com', scope: 'once' }, { ...context, environment: 'local' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'WRONG_EXECUTION_ENVIRONMENT' } })
    expect(grantNetwork).not.toHaveBeenCalled()
  })
})
