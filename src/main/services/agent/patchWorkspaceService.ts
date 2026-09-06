import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { copyFile, lstat, mkdir, open, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { WorkspaceBoundaryService } from './workspace'
import { normalizeWorkspaceRelativePath } from './workspace'
import { isEntityId } from './validation'

const MAX_PATCH_FILES = 20
const MAX_PATCH_BYTES = 2 * 1024 * 1024
const SHA256 = /^sha256:[a-f0-9]{64}$/
const SHA256_INPUT = /^(?:sha256:)?[a-f0-9]{64}$/

export type StructuredTextChange =
  | { type: 'write'; path: string; expectedHash: string | null; content: string }
  | { type: 'delete'; path: string; expectedHash: string }
  | { type: 'rename'; from: string; path: string; expectedHash: string }

export interface PatchFileChange {
  path: string
  previousPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  beforeHash?: string
  afterHash?: string
  linesAdded: number
  linesDeleted: number
  diff: string
}

export interface PatchManifest {
  patchHash: string
  files: PatchFileChange[]
  added: number
  modified: number
  deleted: number
  renamed: number
  linesAdded: number
  linesDeleted: number
}

interface Snapshot { content: string; hash: string }
interface OverlayEntry { baseline: Snapshot | null; current: Snapshot | null; renamedFrom?: string }
interface TaskOverlay { workspaceId: string; entries: Map<string, OverlayEntry> }

export class PatchWorkspaceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PatchWorkspaceError'
  }
}

/** Task-scoped text overlay. It never writes to the authorized host workspace. */
export class PatchWorkspaceService {
  private readonly overlays = new Map<string, TaskOverlay>()

  constructor(
    private readonly workspace: () => WorkspaceBoundaryService,
    private runtimeRoot = join(process.cwd(), '.agent-runtime')
  ) {}

  setRuntimeRoot(runtimeRoot: string): void { this.runtimeRoot = resolve(runtimeRoot) }

  async apply(taskId: string, workspaceId: string, changes: StructuredTextChange[]): Promise<PatchManifest> {
    validateChanges(changes)
    const overlay = this.overlay(taskId, workspaceId)
    const touched = new Set<string>()
    for (const change of changes) {
      const path = portablePath(normalizeWorkspaceRelativePath(change.path))
      if (touched.has(path)) throw new PatchWorkspaceError('DUPLICATE_PATH', '同一批次不能重复修改目标路径')
      touched.add(path)
      if (change.type === 'rename') {
        const from = portablePath(normalizeWorkspaceRelativePath(change.from))
        if (from === path || touched.has(from)) throw new PatchWorkspaceError('DUPLICATE_PATH', '重命名源和目标路径冲突')
        touched.add(from)
        const source = await this.load(overlay, workspaceId, from)
        assertExpected(source.current, normalizeExpectedHash(change.expectedHash))
        const destination = await this.load(overlay, workspaceId, path, true)
        if (destination.current) throw new PatchWorkspaceError('TARGET_EXISTS', '重命名目标已存在')
        overlay.entries.set(from, { ...source, current: null })
        overlay.entries.set(path, { baseline: destination.baseline, current: source.current, renamedFrom: from })
        continue
      }
      const entry = await this.load(overlay, workspaceId, path, change.type === 'write' && change.expectedHash === null)
      assertExpected(entry.current, normalizeExpectedHash(change.expectedHash))
      if (change.type === 'delete') {
        overlay.entries.set(path, { ...entry, current: null })
      } else {
        const current = snapshot(change.content)
        overlay.entries.set(path, { ...entry, current })
      }
    }
    return this.manifest(taskId)
  }

  manifest(taskId: string): PatchManifest {
    const overlay = this.overlays.get(taskId)
    const files: PatchFileChange[] = []
    if (overlay) {
      for (const [path, entry] of [...overlay.entries].sort(([a], [b]) => a.localeCompare(b))) {
        if (entry.baseline?.hash === entry.current?.hash) continue
        if (entry.renamedFrom && entry.current) {
          const source = overlay.entries.get(entry.renamedFrom)
          if (source?.baseline?.hash === entry.current.hash && source.current === null) {
            files.push(changeRecord(path, entry, 'renamed'))
            continue
          }
        }
        // The deleted source of a pure rename is represented by its destination.
        if ([...overlay.entries.values()].some((candidate) => candidate.renamedFrom === path &&
          candidate.current?.hash === entry.baseline?.hash)) continue
        files.push(changeRecord(path, entry, entry.baseline ? (entry.current ? 'modified' : 'deleted') : 'added'))
      }
    }
    const counts = (status: PatchFileChange['status']): number => files.filter((file) => file.status === status).length
    const canonical = JSON.stringify(files.map(({ diff: _diff, ...file }) => file))
    return {
      patchHash: hashHex(canonical), files,
      added: counts('added'), modified: counts('modified'), deleted: counts('deleted'), renamed: counts('renamed'),
      linesAdded: files.reduce((sum, file) => sum + file.linesAdded, 0),
      linesDeleted: files.reduce((sum, file) => sum + file.linesDeleted, 0)
    }
  }

  previewContents(taskId: string): Array<{ path: string; originalContent: string; modifiedContent: string }> {
    const overlay = this.overlays.get(taskId)
    if (!overlay) return []
    return this.manifest(taskId).files.map((file) => {
      const entry = overlay.entries.get(file.path)
      const original = file.previousPath
        ? overlay.entries.get(file.previousPath)?.baseline
        : entry?.baseline
      return {
        path: file.path,
        originalContent: original?.content ?? '',
        modifiedContent: entry?.current?.content ?? ''
      }
    })
  }

  clearTask(taskId: string): void {
    this.overlays.delete(taskId)
  }

  rejectFile(taskId: string, workspaceId: string, patchHash: string, path: string): PatchManifest {
    const manifest = this.assertManifest(taskId, workspaceId, patchHash, this.manifest(taskId).files.map((file) => file.path)).manifest
    const normalized = portablePath(normalizeWorkspaceRelativePath(path))
    const file = manifest.files.find((candidate) => candidate.path === normalized)
    if (!file) throw new PatchWorkspaceError('PATCH_PATH_MISMATCH', '要拒绝的文件不在当前补丁中')
    const overlay = this.overlays.get(taskId)!
    overlay.entries.delete(normalized)
    if (file.previousPath) overlay.entries.delete(file.previousPath)
    return this.manifest(taskId)
  }

  approvalPreview(taskId: string, workspaceId: string, patchHash: string, paths: string[]): string {
    const { manifest } = this.assertManifest(taskId, workspaceId, patchHash, paths)
    const diff = manifest.files.map((file) => file.diff).join('\n\n')
    return `批准后将写回 ${manifest.files.length} 个文件（+${manifest.linesAdded} / -${manifest.linesDeleted}）\n补丁 SHA-256：${manifest.patchHash}\n\n${diff}`
  }

  async applyToHost(taskId: string, workspaceId: string, patchHash: string, paths: string[]): Promise<PatchManifest> {
    const { manifest, overlay, ownerTaskId } = this.assertManifest(taskId, workspaceId, patchHash, paths)
    const boundary = this.workspace()
    await boundary.activate(workspaceId)
    const grant = boundary.getGrant(workspaceId)
    if (!grant) throw new PatchWorkspaceError('UNKNOWN_WORKSPACE', '工作区授权已失效')
    const backupRoot = this.backupRoot(taskId, patchHash)
    await mkdir(backupRoot, { recursive: true, mode: 0o700 })
    const operations: Array<{ path: string; target: string; entry: OverlayEntry; temp?: string; existed: boolean; identity?: string }> = []
    for (const file of manifest.files) {
      const entry = overlay.entries.get(file.path)!
      if (file.status === 'renamed' && file.previousPath) {
        const source = overlay.entries.get(file.previousPath)
        if (!source?.baseline || source.current) throw new PatchWorkspaceError('PATCH_INVALID', '重命名源状态无效')
        const sourceTarget = await safeHostTarget(grant.realRootPath, file.previousPath, false)
        const sourceContent = await readSafeText(sourceTarget)
        if (hashText(sourceContent) !== source.baseline.hash) {
          throw new PatchWorkspaceError('BASELINE_MISMATCH', `${file.previousPath} 在任务期间已被修改，写回已停止`)
        }
        operations.push({ path: file.previousPath, target: sourceTarget, entry: source, existed: true,
          identity: identity(await lstat(sourceTarget)) })
      }
      const target = await safeHostTarget(grant.realRootPath, file.path, !entry.baseline)
      if (entry.baseline) {
        const current = await readSafeText(target)
        if (hashText(current) !== entry.baseline.hash) {
          throw new PatchWorkspaceError('BASELINE_MISMATCH', `${file.path} 在任务期间已被修改，写回已停止`)
        }
      } else if (await exists(target)) {
        throw new PatchWorkspaceError('BASELINE_MISMATCH', `${file.path} 已由其他操作创建，写回已停止`)
      }
      operations.push({ path: file.path, target, entry, existed: Boolean(entry.baseline),
        ...(entry.baseline ? { identity: identity(await lstat(target)) } : {}) })
    }
    await boundary.activate(workspaceId)
    for (const operation of operations) {
      if (operation.existed) await backupFile(operation.target, join(backupRoot, operation.path))
      if (operation.entry.current) {
        const temp = join(dirname(operation.target), `.ai-agent-${patchHash.slice(0, 12)}-${createHash('sha256').update(operation.path).digest('hex').slice(0, 12)}.tmp`)
        await writeFile(temp, operation.entry.current.content, { flag: 'wx', mode: 0o600 })
        const handle = await open(temp, 'r+')
        try { await handle.sync() } finally { await handle.close() }
        operation.temp = temp
      }
    }
    await writeFile(join(backupRoot, 'manifest.json'), JSON.stringify({
      taskId, workspaceId, patchHash, createdAt: Date.now(), files: manifest.files
    }, null, 2), { flag: 'wx', mode: 0o600 })
    const applied: typeof operations = []
    try {
      for (const operation of operations) {
        await boundary.activate(workspaceId)
        await safeHostTarget(grant.realRootPath, operation.path, !operation.existed)
        if (operation.existed && identity(await lstat(operation.target)) !== operation.identity) {
          throw new PatchWorkspaceError('LINK_RACE', `${operation.path} 在写回前被替换，操作已中止`)
        }
        if (operation.temp) await rename(operation.temp, operation.target)
        else await unlink(operation.target)
        operation.temp = undefined
        applied.push(operation)
      }
      const actualFiles: PatchFileChange[] = []
      for (const expected of manifest.files) {
        const beforePath = expected.status === 'renamed' ? expected.previousPath! : expected.path
        const before = expected.status === 'added'
          ? null
          : snapshot(await readSafeText(join(backupRoot, beforePath)))
        const after = expected.status === 'deleted'
          ? null
          : snapshot(await readSafeText(await safeHostTarget(grant.realRootPath, expected.path, false)))
        const actualEntry: OverlayEntry = expected.status === 'renamed'
          ? { baseline: null, current: after, renamedFrom: expected.previousPath }
          : { baseline: before, current: after }
        actualFiles.push(changeRecord(expected.path, actualEntry, expected.status))
      }
      const actualHash = hashHex(JSON.stringify(actualFiles.map(({ diff: _diff, ...file }) => file)))
      if (actualHash !== patchHash || JSON.stringify(actualFiles) !== JSON.stringify(manifest.files)) {
        throw new PatchWorkspaceError('WRITE_VERIFY_FAILED', '写回后的 diff 或哈希与批准内容不一致')
      }
      this.overlays.delete(ownerTaskId)
      return manifest
    } catch (error) {
      await rollback(applied, backupRoot)
      throw error
    } finally {
      for (const operation of operations) if (operation.temp) await rm(operation.temp, { force: true }).catch(() => undefined)
    }
  }

  private overlay(taskId: string, workspaceId: string): TaskOverlay {
    const current = this.overlays.get(taskId)
    if (current && current.workspaceId !== workspaceId) {
      throw new PatchWorkspaceError('WORKSPACE_CHANGED', '任务工作区已变化')
    }
    if (current) return current
    const created = { workspaceId, entries: new Map<string, OverlayEntry>() }
    this.overlays.set(taskId, created)
    return created
  }

  private async load(
    overlay: TaskOverlay,
    workspaceId: string,
    path: string,
    allowMissing = false
  ): Promise<OverlayEntry> {
    const cached = overlay.entries.get(path)
    if (cached) return cached
    try {
      const file = await this.workspace().readFile(workspaceId, path)
      // The read service hashes the original bytes. Keep that trusted hash
      // instead of recomputing from a display-normalized representation.
      const baseline = { content: file.content, hash: file.hash }
      const entry = { baseline, current: baseline }
      overlay.entries.set(path, entry)
      return entry
    } catch (error) {
      if (!allowMissing || (error as { code?: string }).code !== 'NOT_FOUND') throw error
      const entry = { baseline: null, current: null }
      overlay.entries.set(path, entry)
      return entry
    }
  }

  private assertManifest(
    taskId: string,
    workspaceId: string,
    patchHash: string,
    paths: string[]
  ): { manifest: PatchManifest; overlay: TaskOverlay; ownerTaskId: string } {
    const candidates = [...this.overlays.entries()]
      .filter(([, candidate]) => candidate.workspaceId === workspaceId)
      .sort(([candidateTaskId]) => candidateTaskId === taskId ? -1 : 0)
    if (!candidates.length) throw new PatchWorkspaceError('PATCH_NOT_FOUND', '待审批补丁不存在或已失效')
    if (!/^[a-f0-9]{64}$/.test(patchHash)) {
      throw new PatchWorkspaceError('PATCH_HASH_MISMATCH', '补丁内容与批准哈希不一致')
    }
    const match = candidates
      .map(([ownerTaskId, overlay]) => ({ ownerTaskId, overlay, manifest: this.manifest(ownerTaskId) }))
      .find((candidate) => candidate.manifest.patchHash === patchHash)
    if (!match) throw new PatchWorkspaceError('PATCH_HASH_MISMATCH', '补丁内容与批准哈希不一致')
    const { manifest } = match
    const actual = manifest.files.map((file) => file.path).sort()
    const requested = [...new Set(paths.map((path) => portablePath(normalizeWorkspaceRelativePath(path))))].sort()
    if (requested.length !== paths.length || JSON.stringify(actual) !== JSON.stringify(requested)) {
      throw new PatchWorkspaceError('PATCH_PATH_MISMATCH', '写回文件列表与补丁不一致')
    }
    return match
  }

  private backupRoot(taskId: string, patchHash: string): string {
    if (!isEntityId(taskId)) throw new PatchWorkspaceError('INVALID_TASK', '任务标识无效')
    const root = resolve(this.runtimeRoot)
    // Runtime ids are `task-<uuid>` and valid entity ids may also contain
    // Windows-unsafe characters such as `:`. Never use an identifier as a
    // filesystem segment; map it to a deterministic, collision-resistant key.
    const taskDirectory = `task-${hashHex(taskId)}`
    const target = resolve(root, taskDirectory, 'patch-backup', patchHash)
    const rel = relative(root, target)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new PatchWorkspaceError('INVALID_TASK', '备份路径越界')
    return target
  }
}

function validateChanges(changes: StructuredTextChange[]): void {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_PATCH_FILES) {
    throw new PatchWorkspaceError('PATCH_LIMIT', `一次必须修改 1 到 ${MAX_PATCH_FILES} 个文件`)
  }
  let bytes = 0
  for (const change of changes) {
    if (!change || typeof change !== 'object' || !['write', 'delete', 'rename'].includes(change.type)) {
      throw new PatchWorkspaceError('INVALID_PATCH', '结构化文本变更无效')
    }
    const allowed = change.type === 'write'
      ? ['type', 'path', 'expectedHash', 'content']
      : change.type === 'delete'
        ? ['type', 'path', 'expectedHash']
        : ['type', 'from', 'path', 'expectedHash']
    if (!Object.keys(change).every((key) => allowed.includes(key))) {
      throw new PatchWorkspaceError('INVALID_PATCH', '结构化文本变更包含未允许字段')
    }
    if (typeof change.path !== 'string') throw new PatchWorkspaceError('INVALID_PATCH', '目标路径无效')
    if (change.type === 'write') {
      if (typeof change.content !== 'string' || (change.expectedHash !== null && !SHA256_INPUT.test(change.expectedHash))) {
        throw new PatchWorkspaceError('INVALID_PATCH', '写入内容或预期哈希无效')
      }
      bytes += Buffer.byteLength(change.content, 'utf8')
    } else if (!SHA256_INPUT.test(change.expectedHash) || (change.type === 'rename' && typeof change.from !== 'string')) {
      throw new PatchWorkspaceError('INVALID_PATCH', '删除或重命名参数无效')
    }
  }
  if (bytes > MAX_PATCH_BYTES) throw new PatchWorkspaceError('PATCH_LIMIT', '单批文本变更超过 2MB')
}

function assertExpected(current: Snapshot | null, expectedHash: string | null): void {
  if (expectedHash === null) {
    if (current) throw new PatchWorkspaceError('TARGET_EXISTS', '新增文件目标已存在')
    return
  }
  if (!SHA256.test(expectedHash) || current?.hash !== expectedHash) {
    throw new PatchWorkspaceError('BASELINE_MISMATCH', '文件内容已变化，请重新读取后生成补丁')
  }
}

function normalizeExpectedHash(value: string | null): string | null {
  if (value === null || value.startsWith('sha256:')) return value
  return `sha256:${value}`
}

function snapshot(content: string): Snapshot {
  return { content, hash: hashText(content) }
}

function hashText(content: string): string {
  return `sha256:${hashHex(content)}`
}

function hashHex(content: string): string { return createHash('sha256').update(content, 'utf8').digest('hex') }

function portablePath(path: string): string {
  return path.replaceAll('\\', '/')
}

function changeRecord(path: string, entry: OverlayEntry, status: PatchFileChange['status']): PatchFileChange {
  const oldPath = status === 'renamed' ? entry.renamedFrom : path
  const before = status === 'renamed' ? entry.current : entry.baseline
  const oldLines = before?.content.split('\n') ?? []
  const newLines = entry.current?.content.split('\n') ?? []
  const { removed, added } = changedRange(oldLines, newLines)
  const headers = status === 'renamed'
    ? [`rename from ${entry.renamedFrom}`, `rename to ${path}`]
    : [`--- ${entry.baseline ? `a/${path}` : '/dev/null'}`, `+++ ${entry.current ? `b/${path}` : '/dev/null'}`]
  const diff = status === 'renamed' && removed.length === 0 && added.length === 0
    ? headers.join('\n')
    : [...headers, `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
        ...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`)].join('\n')
  return {
    path, ...(status === 'renamed' ? { previousPath: oldPath } : {}), status,
    ...(before ? { beforeHash: before.hash } : {}),
    ...(entry.current ? { afterHash: entry.current.hash } : {}),
    linesAdded: added.length, linesDeleted: removed.length, diff
  }
}

function changedRange(oldLines: string[], newLines: string[]): { removed: string[]; added: string[] } {
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1
  let suffix = 0
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1
  return {
    removed: oldLines.slice(prefix, oldLines.length - suffix),
    added: newLines.slice(prefix, newLines.length - suffix)
  }
}

async function safeHostTarget(root: string, portable: string, allowMissing: boolean): Promise<string> {
  const normalized = normalizeWorkspaceRelativePath(portable)
  const target = resolve(root, normalized)
  const rel = relative(root, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new PatchWorkspaceError('PATH_ESCAPE', '写回目标越界')
  const segments = rel.split(sep)
  let current = root
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index])
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new PatchWorkspaceError('LINK_BLOCKED', '写回路径包含链接或联接点')
      if (index < segments.length - 1 && !info.isDirectory()) throw new PatchWorkspaceError('NOT_DIRECTORY', '写回父路径不是目录')
      if (index === segments.length - 1 && !info.isFile()) throw new PatchWorkspaceError('NOT_FILE', '写回目标不是普通文件')
    } catch (error) {
      if (index === segments.length - 1 && allowMissing && (error as { code?: string }).code === 'ENOENT') break
      throw error
    }
  }
  const parentReal = await realpath(dirname(target))
  const parentRel = relative(await realpath(root), parentReal)
  if (parentRel === '..' || parentRel.startsWith(`..${sep}`) || (parentRel && relative(root, parentReal).startsWith('..'))) {
    throw new PatchWorkspaceError('PATH_ESCAPE', '写回目标真实路径越界')
  }
  return target
}

async function readSafeText(path: string): Promise<string> {
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_PATCH_BYTES) throw new PatchWorkspaceError('PATCH_LIMIT', '写回文件类型或大小无效')
    const content = await handle.readFile()
    if (content.includes(0)) throw new PatchWorkspaceError('BINARY_FILE', '不允许写回二进制文件')
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(content)
      return content.toString('utf8')
    }
    catch { throw new PatchWorkspaceError('BINARY_FILE', '不允许写回非 UTF-8 文件') }
  } finally { await handle.close() }
}

async function backupFile(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  await copyFile(source, destination, fsConstants.COPYFILE_EXCL)
}

async function rollback(operations: Array<{ path: string; target: string; existed: boolean }>, backupRoot: string): Promise<void> {
  for (const operation of [...operations].reverse()) {
    try {
      if (operation.existed) await copyFile(join(backupRoot, operation.path), operation.target)
      else await rm(operation.target, { force: true })
    } catch { /* Preserve the recoverable backup for manual restoration. */ }
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false
    throw error
  }
}

function identity(info: { dev: number | bigint; ino: number | bigint }): string {
  return `${String(info.dev)}:${String(info.ino)}`
}
