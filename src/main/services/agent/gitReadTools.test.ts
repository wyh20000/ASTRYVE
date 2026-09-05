import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { ExecutionBackend, ExecutionResult, ToolExecutionContext } from '../../../shared/agent'
import { createGitReadTools } from './gitReadTools'

const context: ToolExecutionContext = {
  taskId: 'task-1', callId: 'call-1',
  workspace: { id: 'workspace-1', rootPath: 'D:\\repo', realRootPath: 'D:\\repo', createdAt: 1 },
  environment: 'local', permissionMode: 'read-only', signal: new AbortController().signal
}

function result(stdout = '', stderr = '', exitCode = 0): ExecutionResult {
  return { stdout, stderr, exitCode, durationMs: 1, truncated: false }
}

describe('Git read tools', () => {
  it('uses capture-only structured git argv and rejects unknown fields', async () => {
    const run = vi.fn(async () => result(' M src/a.ts'))
    const backend: ExecutionBackend = { environment: 'local', run, stopTask: vi.fn() }
    const [status] = createGitReadTools(backend)
    expect(status.validateArgs({ action: 'status' })).toBe(true)
    expect(status.validateArgs({ action: 'status', command: 'reset' })).toBe(false)
    await expect(status.execute({ action: 'status' }, context)).resolves.toMatchObject({ ok: true })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      executable: 'git', args: ['status', '--short', '--untracked-files=all', '--', '.'], captureOnly: true
    }), context.signal)
  })

  it('builds diffs only for normalized non-sensitive paths', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(result('src/a.ts\0.env\0../outside.ts\0'))
      .mockResolvedValueOnce(result('diff --git a/src/a.ts b/src/a.ts'))
    const backend: ExecutionBackend = { environment: 'local', run, stopTask: vi.fn() }
    const diff = createGitReadTools(backend)[1]
    await expect(diff.execute({ action: 'diff' }, context)).resolves.toMatchObject({
      ok: true,
      value: { files: [join('src', 'a.ts')], omittedSensitiveFiles: 2, diff: 'diff --git a/src/a.ts b/src/a.ts' }
    })
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({
      args: ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--', join('src', 'a.ts')]
    }), context.signal)
  })

  it('requires a bounded revision and safe path for git show', async () => {
    const backend: ExecutionBackend = { environment: 'local', run: vi.fn(async () => result('file')), stopTask: vi.fn() }
    const show = createGitReadTools(backend)[3]
    expect(show.validateArgs({ action: 'show', revision: 'HEAD~1', path: 'src/a.ts' })).toBe(true)
    expect(show.validateArgs({ action: 'show', revision: '--output=x', path: 'src/a.ts' })).toBe(false)
    await expect(show.execute({ action: 'show', revision: 'HEAD', path: '.env' }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'SENSITIVE_PATH' }
    })
    expect(backend.run).not.toHaveBeenCalled()
  })
})
