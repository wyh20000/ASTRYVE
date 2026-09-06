import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertDockerWorkspaceUsage, collectDockerWorkspaceChanges, createDockerWorkspaceCopy } from './dockerWorkspaceCopy'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('Docker workspace copy', () => {
  it('copies ordinary project files but excludes secrets, generated trees and links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docker-copy-source-'))
    const runtime = await mkdtemp(join(tmpdir(), 'docker-copy-runtime-'))
    roots.push(root, runtime)
    await mkdir(join(root, 'src'))
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'src', 'index.ts'), 'export const ok = true')
    await writeFile(join(root, '.env.local'), 'SECRET=value')
    await writeFile(join(root, '.git', 'config'), 'secret')
    await writeFile(join(root, 'node_modules', 'module.js'), 'generated')
    let linked = false
    try {
      await symlink(join(root, 'src', 'index.ts'), join(root, 'linked.ts'))
      linked = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    }

    const copy = await createDockerWorkspaceCopy(root, runtime)
    await expect(readFile(join(copy.rootPath, 'src', 'index.ts'), 'utf8')).resolves.toBe('export const ok = true')
    await expect(readFile(join(copy.rootPath, '.env.local'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(copy.rootPath, '.git', 'config'), 'utf8')).rejects.toThrow()
    if (linked) await expect(readFile(join(copy.rootPath, 'linked.ts'), 'utf8')).rejects.toThrow()
    expect(copy).toMatchObject({ fileCount: 1, skippedEntries: linked ? 4 : 3 })
  })

  it('rejects special roots and oversized files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docker-copy-source-'))
    const runtime = await mkdtemp(join(tmpdir(), 'docker-copy-runtime-'))
    roots.push(root, runtime)
    await writeFile(join(root, 'large.bin'), Buffer.alloc(16 * 1024 * 1024 + 1))
    await expect(createDockerWorkspaceCopy(root, runtime)).rejects.toThrow('DOCKER_WORKSPACE_FILE_TOO_LARGE')
  })

  it('rejects links created inside the disposable runtime copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docker-copy-runtime-'))
    roots.push(root)
    try {
      await symlink(join(root, 'missing'), join(root, 'container-link'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    await expect(assertDockerWorkspaceUsage(root)).rejects.toThrow('DOCKER_WORKSPACE_OUTPUT_LIMIT')
  })

  it('exports bounded hashes, text diffs and an artifact manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docker-copy-source-'))
    const runtime = await mkdtemp(join(tmpdir(), 'docker-copy-runtime-'))
    roots.push(root, runtime)
    await writeFile(join(root, 'changed.txt'), 'before\n')
    await writeFile(join(root, 'deleted.txt'), 'gone\n')
    const copy = await createDockerWorkspaceCopy(root, runtime)
    await writeFile(join(copy.rootPath, 'changed.txt'), 'after\n')
    await writeFile(join(copy.rootPath, 'added.txt'), 'new\n')
    await rm(join(copy.rootPath, 'deleted.txt'))
    const manifest = await collectDockerWorkspaceChanges(copy)
    expect(manifest).toMatchObject({ added: 1, modified: 1, deleted: 1, truncated: false })
    expect(manifest.files.map((file) => [file.path, file.status])).toEqual([
      ['added.txt', 'added'], ['changed.txt', 'modified'], ['deleted.txt', 'deleted']
    ])
    expect(manifest.files.every((file) => (file.beforeHash ?? file.afterHash)?.startsWith('sha256:'))).toBe(true)
    expect(manifest.files.find((file) => file.path === 'changed.txt')?.diff).toContain('+after')
  })
})
