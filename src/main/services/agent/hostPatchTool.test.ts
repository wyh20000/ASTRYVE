import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryWorkspaceGrantStorage, WorkspaceBoundaryService } from './workspace'
import { PatchWorkspaceService } from './patchWorkspaceService'
import { createHostPatchTool } from './hostPatchTool'

const roots: string[] = []
const digest = (value: string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`
const taskDirectory = (taskId: string): string => `task-${createHash('sha256').update(taskId).digest('hex')}`

async function setup(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'ai-agent-host-patch-'))
  const runtime = await mkdtemp(join(tmpdir(), 'ai-agent-host-patch-runtime-'))
  roots.push(root, runtime)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const workspace = new WorkspaceBoundaryService(new InMemoryWorkspaceGrantStorage())
  const grant = await workspace.createGrant(root)
  const patches = new PatchWorkspaceService(() => workspace, runtime)
  return { root, runtime, workspace, workspaceId: grant.id, patches }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('approved host patch writeback', () => {
  it('derives approval text from trusted patch state and includes the exact diff', async () => {
    const fixture = await setup({ 'a.txt': 'one' })
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0'
    const manifest = await fixture.patches.apply(taskId, fixture.workspaceId, [{
      type: 'write', path: 'a.txt', expectedHash: digest('one'), content: 'two'
    }])
    const tool = createHostPatchTool(fixture.patches)
    const grant = fixture.workspace.getGrant(fixture.workspaceId)!
    const summary = await tool.approvalSummary!({ paths: ['a.txt'], patchHash: manifest.patchHash }, {
      taskId, callId: 'call', workspace: grant, environment: 'local', permissionMode: 'ask-every-time',
      signal: new AbortController().signal
    })
    expect(summary).toContain(`补丁 SHA-256：${manifest.patchHash}`)
    expect(summary).toContain('--- a/a.txt')
    expect(summary).toContain('+two')
  })

  it('writes the exact patch, verifies it, and preserves task-level backups', async () => {
    const fixture = await setup({ 'src/a.ts': 'old', 'delete.txt': 'remove' })
    const taskId = 'task-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    const manifest = await fixture.patches.apply(taskId, fixture.workspaceId, [
      { type: 'write', path: 'src/a.ts', expectedHash: digest('old'), content: 'new' },
      { type: 'delete', path: 'delete.txt', expectedHash: digest('remove') },
      { type: 'write', path: 'added.txt', expectedHash: null, content: 'added' }
    ])
    const paths = manifest.files.map((file) => file.path)
    await expect(fixture.patches.applyToHost(taskId, fixture.workspaceId, manifest.patchHash, paths))
      .resolves.toMatchObject({ modified: 1, deleted: 1, added: 1 })
    await expect(readFile(join(fixture.root, 'src/a.ts'), 'utf8')).resolves.toBe('new')
    await expect(readFile(join(fixture.root, 'added.txt'), 'utf8')).resolves.toBe('added')
    await expect(readFile(join(fixture.root, 'delete.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const backup = join(fixture.runtime, taskDirectory(taskId), 'patch-backup', manifest.patchHash)
    await expect(readFile(join(backup, 'src/a.ts'), 'utf8')).resolves.toBe('old')
    await expect(readFile(join(backup, 'delete.txt'), 'utf8')).resolves.toBe('remove')
  })

  it('round-trips UTF-8 BOM and mixed line endings with the byte hash returned by readFile', async () => {
    const original = '\uFEFFexport const one = 1\nexport const two = 2\r\n'
    const updated = `${original}export const three = 3\n`
    const fixture = await setup({ 'src/mixed.ts': original })
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'
    const read = await fixture.workspace.readFile(fixture.workspaceId, 'src/mixed.ts')
    expect(read.content).toBe(original)
    expect(read.hash).toBe(digest(original))
    const manifest = await fixture.patches.apply(taskId, fixture.workspaceId, [{
      type: 'write', path: 'src/mixed.ts', expectedHash: read.hash, content: updated
    }])
    await fixture.patches.applyToHost(taskId, fixture.workspaceId, manifest.patchHash, ['src/mixed.ts'])
    await expect(readFile(join(fixture.root, 'src/mixed.ts'))).resolves.toEqual(Buffer.from(updated))
  })

  it('applies a completed task patch from a later approval task with the exact hash', async () => {
    const fixture = await setup({ 'a.txt': 'one' })
    const patchTaskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
    const approvalTaskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5'
    const manifest = await fixture.patches.apply(patchTaskId, fixture.workspaceId, [{
      type: 'write', path: 'a.txt', expectedHash: digest('one'), content: 'two'
    }])
    await expect(fixture.patches.applyToHost(
      approvalTaskId,
      fixture.workspaceId,
      manifest.patchHash,
      ['a.txt']
    )).resolves.toMatchObject({ modified: 1 })
    await expect(readFile(join(fixture.root, 'a.txt'), 'utf8')).resolves.toBe('two')
    expect(fixture.patches.manifest(patchTaskId).files).toHaveLength(0)
    await expect(readFile(join(fixture.runtime, taskDirectory(approvalTaskId), 'patch-backup', manifest.patchHash, 'a.txt'), 'utf8'))
      .resolves.toBe('one')
  })

  it('stops on concurrent host edits, patch hash tampering, and path-list changes', async () => {
    const fixture = await setup({ 'a.txt': 'one' })
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
    const manifest = await fixture.patches.apply(taskId, fixture.workspaceId, [{
      type: 'write', path: 'a.txt', expectedHash: digest('one'), content: 'two'
    }])
    await expect(fixture.patches.applyToHost(taskId, fixture.workspaceId, '0'.repeat(64), ['a.txt']))
      .rejects.toMatchObject({ code: 'PATCH_HASH_MISMATCH' })
    await expect(fixture.patches.applyToHost(taskId, fixture.workspaceId, manifest.patchHash, ['other.txt']))
      .rejects.toMatchObject({ code: 'PATCH_PATH_MISMATCH' })
    await writeFile(join(fixture.root, 'a.txt'), 'user edit')
    await expect(fixture.patches.applyToHost(taskId, fixture.workspaceId, manifest.patchHash, ['a.txt']))
      .rejects.toMatchObject({ code: 'BASELINE_MISMATCH' })
    await expect(readFile(join(fixture.root, 'a.txt'), 'utf8')).resolves.toBe('user edit')
  })

  it('applies a rename and retains a backup of the original path', async () => {
    const fixture = await setup({ 'old.txt': 'same' })
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
    const manifest = await fixture.patches.apply(taskId, fixture.workspaceId, [{
      type: 'rename', from: 'old.txt', path: 'new.txt', expectedHash: digest('same')
    }])
    await fixture.patches.applyToHost(taskId, fixture.workspaceId, manifest.patchHash, ['new.txt'])
    await expect(readFile(join(fixture.root, 'old.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(fixture.root, 'new.txt'), 'utf8')).resolves.toBe('same')
    await expect(readFile(join(fixture.runtime, taskDirectory(taskId), 'patch-backup', manifest.patchHash, 'old.txt'), 'utf8'))
      .resolves.toBe('same')
  })

  it('rejects linked target paths', async () => {
    const fixture = await setup({ 'real.txt': 'one' })
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
    try { await symlink(join(fixture.root, 'real.txt'), join(fixture.root, 'linked.txt'), 'file') }
    catch { return } // Some Windows test environments do not grant symlink privileges.
    await expect(fixture.patches.apply(taskId, fixture.workspaceId, [{
      type: 'write', path: 'linked.txt', expectedHash: digest('one'), content: 'two'
    }])).rejects.toBeTruthy()
  })
})
