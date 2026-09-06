import { describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext } from '../../../shared/agent'
import { createWorkspacePatchTool } from './workspacePatchTool'

const context = {
  taskId: 'task', callId: 'call', workspace: { id: 'workspace' },
  environment: 'docker', permissionMode: 'smart-approval', signal: new AbortController().signal
} as ToolExecutionContext

describe('workspace.patch tool', () => {
  it('exposes a closed structured schema and delegates only validated changes', async () => {
    const service = { apply: vi.fn(async () => ({ patchHash: 'sha256:x', files: [] })) }
    const tool = createWorkspacePatchTool(service as never)
    const args = { path: 'a.ts', changes: [{ type: 'write' as const, path: 'a.ts', expectedHash: null, content: 'x' }] }
    expect(tool.validateArgs(args)).toBe(true)
    expect(tool.validateArgs({ ...args, command: 'echo bad' })).toBe(false)
    await expect(tool.execute(args, context)).resolves.toMatchObject({ ok: true })
    expect(service.apply).toHaveBeenCalledWith('task', 'workspace', args.changes)
  })
})
