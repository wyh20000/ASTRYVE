import { describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext } from '../../../shared/agent'
import type { WorkspaceBoundaryService } from './workspace'
import { createWorkspaceReadTools } from './workspaceReadTools'

const context: ToolExecutionContext = {
  taskId: 'task-1', callId: 'call-1',
  workspace: { id: 'workspace-1', rootPath: 'D:\\repo', realRootPath: 'D:\\repo', createdAt: 1 },
  environment: 'local', permissionMode: 'read-only', signal: new AbortController().signal
}

describe('workspace read tools', () => {
  it('exports closed schemas and bounded file/list/search results', async () => {
    const service = {
      listFiles: vi.fn(async () => Array.from({ length: 4 }, (_, index) => ({
        path: `src/${index}.ts`, name: `${index}.ts`, kind: 'file' as const, size: 2
      }))),
      readFile: vi.fn(async () => ({ path: 'src/a.ts', content: 'one\ntwo\nthree', size: 13, encoding: 'utf-8' as const })),
      searchText: vi.fn(async () => Array.from({ length: 3 }, (_, index) => ({
        path: 'src/a.ts', line: index + 1, column: 1, preview: 'hit'
      })))
    } as unknown as WorkspaceBoundaryService
    const [list, read, search, find] = createWorkspaceReadTools(() => service)

    expect(list.validateArgs({ limit: 2 })).toBe(true)
    expect(list.validateArgs({ path: '' })).toBe(true)
    expect(search.validateArgs({ query: 'hit', path: '' })).toBe(true)
    expect(find.validateArgs({ query: '2.ts', path: '' })).toBe(true)
    expect(list.validateArgs({ limit: 2, unexpected: true })).toBe(false)
    await expect(list.execute({ limit: 2 }, context)).resolves.toMatchObject({
      ok: true, value: { total: 4, truncated: true, entries: [{ path: 'src/0.ts' }, { path: 'src/1.ts' }] }
    })
    await expect(read.execute({ path: 'src/a.ts', startLine: 2, endLine: 2 }, context)).resolves.toMatchObject({
      ok: true, value: { content: 'two', startLine: 2, endLine: 2, totalLines: 3, truncated: true, nextStartLine: 3 }
    })
    const complete = await read.execute({ path: 'src/a.ts' }, context)
    expect(complete).toMatchObject({
      ok: true, value: { content: 'one\ntwo\nthree', endLine: 3, truncated: false }
    })
    expect(complete.value).not.toHaveProperty('nextStartLine')
    await expect(search.execute({ query: 'hit', limit: 2 }, context)).resolves.toMatchObject({
      ok: true, value: { total: 3, truncated: true }
    })
    await expect(find.execute({ query: '2.ts' }, context)).resolves.toMatchObject({
      ok: true, value: { total: 1, matches: [{ path: 'src/2.ts' }] }
    })
  })

  it('returns a structured error without weakening workspace rejections', async () => {
    const service = { readFile: vi.fn(async () => { throw Object.assign(new Error('敏感路径'), { code: 'SENSITIVE_PATH' }) }) } as unknown as WorkspaceBoundaryService
    const read = createWorkspaceReadTools(() => service)[1]
    await expect(read.execute({ path: '.env' }, context)).resolves.toEqual({
      ok: false, error: { code: 'SENSITIVE_PATH', message: '敏感路径' }
    })
  })
})
