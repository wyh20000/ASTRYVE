import { createHash } from 'crypto'
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join, parse } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryWorkspaceGrantStorage,
  WorkspaceBoundaryService,
  WorkspaceError,
  isPathInside,
  normalizeWorkspaceRelativePath
} from './workspace'

async function expectWorkspaceError(
  action: () => Promise<unknown> | unknown,
  code: WorkspaceError['code']
): Promise<void> {
  let caught: unknown
  try {
    await action()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(WorkspaceError)
  expect((caught as WorkspaceError).code).toBe(code)
}

describe('WorkspaceBoundaryService', () => {
  let tempRoot: string
  let projectRoot: string
  let service: WorkspaceBoundaryService
  let workspaceId: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'ai-agent-workspace-'))
    projectRoot = join(tempRoot, 'project')
    await mkdir(join(projectRoot, 'src'), { recursive: true })
    await mkdir(join(projectRoot, 'node_modules', 'hidden-package'), { recursive: true })
    await writeFile(join(projectRoot, 'README.md'), '# fixture\nneedle here\n', 'utf-8')
    await writeFile(join(projectRoot, 'src', 'main.ts'), 'export const value = 1\n', 'utf-8')
    await writeFile(join(projectRoot, 'node_modules', 'hidden-package', 'secret.ts'), 'needle generated\n', 'utf-8')
    service = new WorkspaceBoundaryService(new InMemoryWorkspaceGrantStorage())
    workspaceId = (await service.createGrant(projectRoot, 100)).id
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('stores real roots in main while exposing only a summary', () => {
    const summary = service.listRecent()[0]
    const grant = service.getGrant(workspaceId)
    expect(summary).not.toHaveProperty('realRootPath')
    expect(summary.displayPath).toBe(projectRoot)
    expect(grant?.realRootPath).toBeTruthy()
    expect(grant?.rootIdentity).toBeTruthy()
  })

  it('refuses broad disk-root and home-directory grants', async () => {
    await expectWorkspaceError(() => service.createGrant(parse(projectRoot).root), 'INVALID_ROOT')
    await expectWorkspaceError(() => service.createGrant(homedir()), 'INVALID_ROOT')
  })

  it('normalizes safe relative paths and rejects absolute, traversal and sensitive paths', async () => {
    expect(normalizeWorkspaceRelativePath('src/main.ts')).toContain('src')
    await expectWorkspaceError(() => service.readFile(workspaceId, '../outside.txt'), 'INVALID_PATH')
    await expectWorkspaceError(() => service.readFile(workspaceId, join(tempRoot, 'outside.txt')), 'INVALID_PATH')
    await expectWorkspaceError(() => service.readFile(workspaceId, '.env'), 'SENSITIVE_PATH')
    await expectWorkspaceError(() => service.readFile(workspaceId, '.env.local'), 'SENSITIVE_PATH')
    await expectWorkspaceError(() => service.readFile(workspaceId, '.git/config'), 'SENSITIVE_PATH')
    expect(() => normalizeWorkspaceRelativePath('\\\\server\\share\\file.ts')).toThrow(WorkspaceError)
    expect(() => normalizeWorkspaceRelativePath('src/file.ts:secret')).toThrow(WorkspaceError)
    expect(() => normalizeWorkspaceRelativePath('src/trailing.')).toThrow(WorkspaceError)
  })

  it('lists, reads and searches bounded text files', async () => {
    const files = await service.listFiles(workspaceId)
    expect(files.map((entry) => entry.path)).toContain('src/main.ts')
    expect(files.some((entry) => entry.path.startsWith('node_modules'))).toBe(false)
    await expect(service.readFile(workspaceId, 'README.md')).resolves.toMatchObject({
      content: '# fixture\nneedle here\n',
      encoding: 'utf-8'
    })
    await expect(service.readMany(workspaceId, ['README.md', 'src/main.ts'])).resolves.toHaveLength(2)
    await expect(service.searchText(workspaceId, 'needle')).resolves.toEqual([
      expect.objectContaining({ path: 'README.md', line: 2, column: 1 })
    ])
    await expect(service.findFiles(workspaceId, 'main')).resolves.toEqual([
      expect.objectContaining({ path: 'src/main.ts', kind: 'file' })
    ])
  })

  it('returns a bounded directory prefix instead of failing large listings', async () => {
    const files = await service.listFiles(workspaceId, '', 2)
    expect(files).toHaveLength(2)
  })

  it('saves an explicitly edited file and rejects a stale editor version', async () => {
    const before = await service.readFile(workspaceId, 'src/main.ts')
    const saved = await service.saveFile(workspaceId, 'src/main.ts', 'export const changed = true\n', before.hash)
    expect(saved.content).toBe('export const changed = true\n')
    expect(saved.hash).not.toBe(before.hash)
    await expectWorkspaceError(
      () => service.saveFile(workspaceId, 'src/main.ts', 'stale', before.hash),
      'ROOT_CHANGED'
    )
  })

  it('returns byte-reproducible UTF-8 text including BOM and mixed line endings', async () => {
    const exact = '\uFEFFfirst\nsecond\r\n'
    await writeFile(join(projectRoot, 'src', 'mixed.txt'), Buffer.from(exact, 'utf8'))
    const result = await service.readFile(workspaceId, 'src/mixed.txt')
    expect(result.content).toBe(exact)
    expect(result.hash).toBe(`sha256:${createHash('sha256').update(Buffer.from(exact)).digest('hex')}`)
  })

  it('pages direct directory children without imposing a project-wide limit', async () => {
    await writeFile(join(projectRoot, 'a.txt'), 'a', 'utf-8')
    await writeFile(join(projectRoot, 'b.txt'), 'b', 'utf-8')
    const first = await service.listDirectory(workspaceId, '', 0, 2)
    expect(first.entries).toHaveLength(2)
    expect(first.nextOffset).toBe(2)
    const second = await service.listDirectory(workspaceId, '', first.nextOffset, 2)
    expect(second.entries.length).toBeGreaterThan(0)
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.path)).size)
      .toBe(first.entries.length + second.entries.length)
  })

  it('rejects binary and oversized files', async () => {
    await writeFile(join(projectRoot, 'binary.bin'), Buffer.from([0, 1, 2, 3]))
    await writeFile(join(projectRoot, 'huge.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 65))
    await writeFile(join(projectRoot, 'invalid-utf8.txt'), Buffer.from([0xc3, 0x28]))
    await expectWorkspaceError(() => service.readFile(workspaceId, 'binary.bin'), 'BINARY_FILE')
    await expectWorkspaceError(() => service.readFile(workspaceId, 'huge.txt'), 'LIMIT_EXCEEDED')
    await expectWorkspaceError(() => service.readFile(workspaceId, 'invalid-utf8.txt'), 'BINARY_FILE')
  })

  it('blocks links even when they point inside or outside the workspace', async () => {
    const outside = join(tempRoot, 'outside.txt')
    await writeFile(outside, 'secret', 'utf-8')
    const link = join(projectRoot, 'linked.txt')
    try {
      await symlink(outside, link, 'file')
    } catch {
      return
    }
    await expectWorkspaceError(() => service.readFile(workspaceId, 'linked.txt'), 'PATH_ESCAPE')
    const listed = await service.listFiles(workspaceId)
    expect(listed.some((entry) => entry.path === 'linked.txt')).toBe(false)
  })

  it('detects replacement of the authorized root directory', async () => {
    const moved = join(tempRoot, 'project-original')
    await rename(projectRoot, moved)
    await mkdir(projectRoot)
    await writeFile(join(projectRoot, 'README.md'), 'replacement', 'utf-8')
    await expectWorkspaceError(() => service.readFile(workspaceId, 'README.md'), 'ROOT_CHANGED')
    await expectWorkspaceError(() => service.activate(workspaceId), 'ROOT_CHANGED')
  })

  it('drops malformed persisted grants instead of trusting settings data', () => {
    const tampered = new WorkspaceBoundaryService(
      new InMemoryWorkspaceGrantStorage([
        {
          id: 'not-a-valid-id',
          rootPath: projectRoot,
          realRootPath: projectRoot,
          rootIdentity: 'fake',
          createdAt: 1
        }
      ])
    )
    expect(tampered.listRecent()).toEqual([])
  })

  it('performs case-aware root containment checks', () => {
    expect(isPathInside(projectRoot, join(projectRoot, 'src', 'main.ts'))).toBe(true)
    expect(isPathInside(projectRoot, join(tempRoot, 'project-evil', 'main.ts'))).toBe(false)
  })
})
