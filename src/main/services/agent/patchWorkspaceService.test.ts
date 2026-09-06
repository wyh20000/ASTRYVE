import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PatchWorkspaceService } from './patchWorkspaceService'
import { hasSafeValueShape } from './validation'

const digest = (value: string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`

function fixture(files: Record<string, string>) {
  const readFile = async (_workspaceId: string, path: string) => {
    if (!(path in files)) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' })
    return {
      path, content: files[path], size: Buffer.byteLength(files[path]),
      encoding: 'utf-8' as const, hash: digest(files[path])
    }
  }
  return { readFile }
}

describe('task-scoped patch workspace', () => {
  it('applies structured writes without touching the host source and returns diff statistics', async () => {
    const host = { 'src/a.ts': 'const a = 1\n' }
    const service = new PatchWorkspaceService(() => fixture(host) as never)
    const manifest = await service.apply('task-1', 'workspace-1', [{
      type: 'write', path: 'src/a.ts', expectedHash: digest(host['src/a.ts']), content: 'const a = 2\n'
    }])
    expect(host['src/a.ts']).toBe('const a = 1\n')
    expect(manifest).toMatchObject({ modified: 1, added: 0, deleted: 0, renamed: 0, linesAdded: 1, linesDeleted: 1 })
    expect(manifest.files[0].diff).toContain('--- a/src/a.ts')
    expect(manifest.files[0].diff).toContain('+const a = 2')
    expect(manifest.patchHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('requires exact current hashes and accepts a subsequent edit against the overlay hash', async () => {
    const service = new PatchWorkspaceService(() => fixture({ 'a.txt': 'one' }) as never)
    await expect(service.apply('task', 'workspace', [{
      type: 'write', path: 'a.txt', expectedHash: digest('wrong'), content: 'two'
    }])).rejects.toMatchObject({ code: 'BASELINE_MISMATCH' })
    const first = await service.apply('task', 'workspace', [{
      type: 'write', path: 'a.txt', expectedHash: digest('one'), content: 'two'
    }])
    const second = await service.apply('task', 'workspace', [{
      type: 'write', path: 'a.txt', expectedHash: first.files[0].afterHash!, content: 'three'
    }])
    expect(second.files[0].afterHash).toBe(digest('three'))
  })

  it('accepts a bare 64-character baseline hash and omits undefined result fields', async () => {
    const service = new PatchWorkspaceService(() => fixture({ 'a.txt': 'one' }) as never)
    const manifest = await service.apply('task', 'workspace', [{
      type: 'write', path: 'a.txt', expectedHash: digest('one').slice(7), content: 'two'
    }, {
      type: 'write', path: 'new.txt', expectedHash: null, content: 'new'
    }])
    expect(manifest.modified).toBe(1)
    expect(manifest.added).toBe(1)
    expect(Object.values(manifest.files).flatMap((file) => Object.values(file))).not.toContain(undefined)
    expect(hasSafeValueShape(manifest)).toBe(true)
  })

  it('accepts the byte hash for exact text containing a BOM and mixed line endings', async () => {
    const original = '\uFEFFone\ntwo\r\n'
    const updated = `${original}three\n`
    const service = new PatchWorkspaceService(() => fixture({ 'mixed.txt': original }) as never)
    const manifest = await service.apply('task', 'workspace', [{
      type: 'write', path: 'mixed.txt', expectedHash: digest(original), content: updated
    }])
    expect(manifest).toMatchObject({ modified: 1 })
    expect(service.previewContents('task')[0]).toEqual({
      path: 'mixed.txt', originalContent: original, modifiedContent: updated
    })
  })

  it('summarizes additions, deletions and pure renames', async () => {
    const service = new PatchWorkspaceService(() => fixture({ 'old.ts': 'same', 'gone.ts': 'bye' }) as never)
    const manifest = await service.apply('task', 'workspace', [
      { type: 'rename', from: 'old.ts', path: 'new.ts', expectedHash: digest('same') },
      { type: 'delete', path: 'gone.ts', expectedHash: digest('bye') },
      { type: 'write', path: 'added.ts', expectedHash: null, content: 'new' }
    ])
    expect(manifest).toMatchObject({ added: 1, modified: 0, deleted: 1, renamed: 1 })
    expect(manifest.files.find((file) => file.status === 'renamed')).toMatchObject({
      path: 'new.ts', previousPath: 'old.ts', linesAdded: 0, linesDeleted: 0
    })
  })

  it('rejects absolute, parent and sensitive paths before loading files', async () => {
    const service = new PatchWorkspaceService(() => fixture({}) as never)
    for (const path of ['C:\\outside.txt', '../outside.txt', '.env']) {
      await expect(service.apply(`task-${path}`, 'workspace', [{
        type: 'write', path, expectedHash: null, content: 'x'
      }])).rejects.toBeTruthy()
    }
  })

  it('rejects undeclared fields in structured patch entries', async () => {
    const service = new PatchWorkspaceService(() => fixture({}) as never)
    await expect(service.apply('task', 'workspace', [{
      type: 'write', path: 'a.txt', expectedHash: null, content: 'x', command: 'bad'
    } as never])).rejects.toMatchObject({ code: 'INVALID_PATCH' })
  })

  it('isolates overlays per task and clears completed tasks', async () => {
    const service = new PatchWorkspaceService(() => fixture({ 'a.txt': 'one' }) as never)
    await service.apply('first', 'workspace', [{
      type: 'write', path: 'a.txt', expectedHash: digest('one'), content: 'two'
    }])
    expect(service.manifest('second').files).toHaveLength(0)
    service.clearTask('first')
    expect(service.manifest('first').files).toHaveLength(0)
  })

  it('rejects one file and rotates the patch hash while retaining other changes', async () => {
    const service = new PatchWorkspaceService(() => fixture({ 'a.txt': 'a', 'b.txt': 'b' }) as never)
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const first = await service.apply(taskId, 'workspace', [
      { type: 'write', path: 'a.txt', expectedHash: digest('a'), content: 'aa' },
      { type: 'write', path: 'b.txt', expectedHash: digest('b'), content: 'bb' }
    ])
    const next = service.rejectFile(taskId, 'workspace', first.patchHash, 'a.txt')
    expect(next.patchHash).not.toBe(first.patchHash)
    expect(next.files.map((file) => file.path)).toEqual(['b.txt'])
  })
})
