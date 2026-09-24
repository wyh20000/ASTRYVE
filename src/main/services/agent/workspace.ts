import { constants as fsConstants } from 'fs'
import { open, lstat, readdir, realpath, stat } from 'fs/promises'
import type { FileHandle } from 'fs/promises'
import { homedir } from 'os'
import {
  basename,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
  win32
} from 'path'
import { createHash, randomUUID } from 'crypto'
import type {
  WorkspaceFileContent,
  WorkspaceFileEntry,
  WorkspaceGrant,
  WorkspaceSearchMatch,
  WorkspaceSummary
} from '../../../shared/agent'

export const WORKSPACE_LIMITS = {
  maxDepth: 20,
  maxEntries: 5_000,
  maxSingleFileBytes: 2 * 1024 * 1024,
  maxReadManyFiles: 20,
  maxReadManyBytes: 5 * 1024 * 1024,
  maxSearchFiles: 2_000,
  maxSearchBytes: 10 * 1024 * 1024,
  maxSearchResults: 200,
  maxQueryChars: 256
} as const

const BLOCKED_NAMES = new Set([
  '.env',
  '.npmrc',
  '.pypirc',
  '.netrc',
  'credentials',
  'credentials.json',
  'id_rsa',
  'id_ed25519'
])
const BLOCKED_DIRECTORIES = new Set(['.git', '.ssh', '.gnupg'])
const IGNORED_GENERATED_DIRECTORIES = new Set([
  '.cache', '.next', '.nuxt', '.parcel-cache', '.turbo', '.vite',
  'build', 'coverage', 'dist', 'node_modules', 'out', 'release', 'target'
])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const GRANT_ID = /^[a-f0-9-]{16,64}$/i
const MAX_ROOT_PATH_CHARS = 500

export type WorkspaceErrorCode =
  | 'UNKNOWN_WORKSPACE'
  | 'INVALID_ROOT'
  | 'INVALID_PATH'
  | 'PATH_ESCAPE'
  | 'LINK_BLOCKED'
  | 'SENSITIVE_PATH'
  | 'NOT_FOUND'
  | 'NOT_DIRECTORY'
  | 'NOT_FILE'
  | 'BINARY_FILE'
  | 'LIMIT_EXCEEDED'
  | 'ROOT_CHANGED'

export class WorkspaceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'WorkspaceError'
  }
}

function hashBuffer(content: Uint8Array): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

async function writeHandle(handle: FileHandle, content: Buffer): Promise<void> {
  await handle.truncate(0)
  let offset = 0
  while (offset < content.length) {
    const { bytesWritten } = await handle.write(content, offset, content.length - offset, offset)
    if (bytesWritten < 1) throw new WorkspaceError('ROOT_CHANGED', '文件写入未完成')
    offset += bytesWritten
  }
}

export interface WorkspaceGrantStorage {
  load(): WorkspaceGrant[]
  save(grants: WorkspaceGrant[]): void
}

export class InMemoryWorkspaceGrantStorage implements WorkspaceGrantStorage {
  constructor(private grants: WorkspaceGrant[] = []) {}
  load(): WorkspaceGrant[] {
    return this.grants.map((grant) => ({ ...grant }))
  }
  save(grants: WorkspaceGrant[]): void {
    this.grants = grants.map((grant) => ({ ...grant }))
  }
}

function canonical(value: string): string {
  const normalized = resolve(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

export function isPathInside(rootPath: string, candidatePath: string): boolean {
  const root = canonical(rootPath)
  const candidate = canonical(candidatePath)
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function rejectUnsafeRoot(rootPath: string): void {
  if (
    rootPath.length > MAX_ROOT_PATH_CHARS ||
    !isAbsolute(rootPath) ||
    (win32.isAbsolute(rootPath) && rootPath.startsWith('\\\\'))
  ) {
    throw new WorkspaceError('INVALID_ROOT', '工作区必须是本机绝对目录')
  }
  const normalized = resolve(rootPath)
  if (canonical(parse(normalized).root) === canonical(normalized)) {
    throw new WorkspaceError('INVALID_ROOT', '不能授权磁盘根目录')
  }
  if (canonical(normalized) === canonical(homedir())) {
    throw new WorkspaceError('INVALID_ROOT', '不能授权整个用户主目录')
  }
  if (isBlockedName(basename(normalized).toLocaleLowerCase('en-US'))) {
    throw new WorkspaceError('INVALID_ROOT', '不能直接授权敏感目录')
  }
}

function isBlockedName(lowerName: string): boolean {
  return (
    BLOCKED_NAMES.has(lowerName) ||
    BLOCKED_DIRECTORIES.has(lowerName) ||
    lowerName.startsWith('.env.')
  )
}

export function normalizeWorkspaceRelativePath(input: string, allowRoot = false): string {
  if (typeof input !== 'string' || input.length > 4_096 || CONTROL_CHARACTERS.test(input)) {
    throw new WorkspaceError('INVALID_PATH', '路径格式无效')
  }
  if (!input && allowRoot) return ''
  if (!input || isAbsolute(input) || win32.isAbsolute(input) || input.startsWith('\\\\')) {
    throw new WorkspaceError('INVALID_PATH', '只允许工作区内相对路径')
  }
  const segments = input.split(/[\\/]+/)
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new WorkspaceError('INVALID_PATH', '路径不能包含空段、. 或 ..')
    }
    if (segment.endsWith('.') || segment.endsWith(' ') || segment.includes(':')) {
      throw new WorkspaceError('INVALID_PATH', '路径包含 Windows 不安全片段')
    }
    const lower = segment.toLocaleLowerCase('en-US')
    if (isBlockedName(lower)) {
      throw new WorkspaceError('SENSITIVE_PATH', '该敏感路径不允许访问')
    }
  }
  return segments.join(sep)
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192))
  if (sample.includes(0)) return true
  let suspicious = 0
  for (const byte of sample) {
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1
  }
  return sample.length > 0 && suspicious / sample.length > 0.1
}

function toSummary(grant: WorkspaceGrant): WorkspaceSummary {
  return {
    id: grant.id,
    name: basename(grant.rootPath),
    displayPath: grant.rootPath,
    createdAt: grant.createdAt,
    lastOpenedAt: grant.lastOpenedAt ?? grant.createdAt
  }
}

function identityOf(info: { dev: number | bigint; ino: number | bigint }): string {
  return `${String(info.dev)}:${String(info.ino)}`
}

export class WorkspaceBoundaryService {
  private readonly grants = new Map<string, WorkspaceGrant>()

  constructor(private readonly storage: WorkspaceGrantStorage) {
    for (const grant of storage.load()) {
      try {
        if (
          !GRANT_ID.test(grant.id) ||
          typeof grant.rootPath !== 'string' ||
          typeof grant.realRootPath !== 'string' ||
          typeof grant.rootIdentity !== 'string' ||
          (grant.revoked !== undefined && typeof grant.revoked !== 'boolean') ||
          !Number.isFinite(grant.createdAt) ||
          (grant.lastOpenedAt != null && !Number.isFinite(grant.lastOpenedAt))
        ) {
          continue
        }
        rejectUnsafeRoot(grant.rootPath)
        rejectUnsafeRoot(grant.realRootPath)
        this.grants.set(grant.id, { ...grant })
      } catch {
        // 设置文件不属于信任边界；非法或被篡改的授权直接丢弃。
      }
    }
  }

  listRecent(): WorkspaceSummary[] {
    return [...this.grants.values()]
      .filter((grant) => !grant.revoked)
      .sort((left, right) => (right.lastOpenedAt ?? right.createdAt) - (left.lastOpenedAt ?? left.createdAt))
      .map(toSummary)
  }

  getGrant(workspaceId: string): WorkspaceGrant | undefined {
    const grant = this.grants.get(workspaceId)
    return grant && !grant.revoked ? { ...grant } : undefined
  }

  revokeGrant(workspaceId: string): void {
    const grant = this.requireGrant(workspaceId)
    const previous = grant.revoked
    grant.revoked = true
    try { this.persist() } catch (error) { grant.revoked = previous; throw error }
  }

  findByRootPath(rootPath: string): WorkspaceSummary | undefined {
    const found = [...this.grants.values()].find(
      (grant) => !grant.revoked && canonical(grant.rootPath) === canonical(rootPath)
    )
    return found ? toSummary(found) : undefined
  }

  async createGrant(rootPath: string, now = Date.now()): Promise<WorkspaceSummary> {
    rejectUnsafeRoot(rootPath)
    const selected = resolve(rootPath)
    let rootInfo
    try {
      rootInfo = await lstat(selected)
    } catch {
      throw new WorkspaceError('NOT_FOUND', '所选工作区不存在')
    }
    if (!rootInfo.isDirectory()) throw new WorkspaceError('NOT_DIRECTORY', '工作区必须是目录')
    if (rootInfo.isSymbolicLink()) throw new WorkspaceError('LINK_BLOCKED', '不能授权链接目录')

    const realRootPath = await realpath(selected)
    rejectUnsafeRoot(realRootPath)
    const existing = [...this.grants.values()].find(
      (grant) => canonical(grant.realRootPath) === canonical(realRootPath)
    )
    const grant: WorkspaceGrant = existing
      ? {
          ...existing,
          rootPath: selected,
          realRootPath,
          rootIdentity: identityOf(rootInfo),
          revoked: false,
          lastOpenedAt: now
        }
      : {
          id: randomUUID(),
          rootPath: selected,
          realRootPath,
          rootIdentity: identityOf(rootInfo),
          createdAt: now,
          lastOpenedAt: now
        }
    this.grants.set(grant.id, grant)
    try { this.persist() } catch (error) {
      if (existing) this.grants.set(existing.id, existing)
      else this.grants.delete(grant.id)
      throw error
    }
    return toSummary(grant)
  }

  async activate(workspaceId: string, now = Date.now()): Promise<WorkspaceSummary> {
    const grant = this.requireGrant(workspaceId)
    await this.verifyRoot(grant)
    const previous = grant.lastOpenedAt
    grant.lastOpenedAt = now
    try { this.persist() } catch (error) { grant.lastOpenedAt = previous; throw error }
    return toSummary(grant)
  }

  async listFiles(
    workspaceId: string,
    relativePath = '',
    maxEntries: number = WORKSPACE_LIMITS.maxEntries
  ): Promise<WorkspaceFileEntry[]> {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > WORKSPACE_LIMITS.maxEntries + 1) {
      throw new WorkspaceError('LIMIT_EXCEEDED', '目录列表数量限制无效')
    }
    const start = await this.resolveExisting(workspaceId, relativePath, 'directory', true)
    const root = this.requireGrant(workspaceId).realRootPath
    const result: WorkspaceFileEntry[] = []
    const queue: Array<{ absolute: string; relative: string; depth: number }> = [
      { absolute: start, relative: relativePath ? normalizeWorkspaceRelativePath(relativePath) : '', depth: 0 }
    ]

    while (queue.length) {
      const current = queue.shift()!
      if (current.depth > WORKSPACE_LIMITS.maxDepth) continue
      const children = await readdir(current.absolute, { withFileTypes: true })
      for (const child of children) {
        if (child.isSymbolicLink()) continue
        const lower = child.name.toLocaleLowerCase('en-US')
        if (isBlockedName(lower)) continue
        if (child.isDirectory() && IGNORED_GENERATED_DIRECTORIES.has(lower)) continue
        const childRelative = current.relative ? `${current.relative}/${child.name}` : child.name
        let safeRelative: string
        try {
          safeRelative = normalizeWorkspaceRelativePath(childRelative)
        } catch {
          continue
        }
        const childAbsolute = resolve(root, safeRelative)
        if (!isPathInside(root, childAbsolute)) continue
        const info = await lstat(childAbsolute)
        if (info.isSymbolicLink()) continue
        if (info.isDirectory()) {
          result.push({ path: safeRelative.split(sep).join('/'), name: child.name, kind: 'directory' })
          queue.push({ absolute: childAbsolute, relative: safeRelative, depth: current.depth + 1 })
        } else if (info.isFile()) {
          result.push({ path: safeRelative.split(sep).join('/'), name: child.name, kind: 'file', size: info.size })
        }
        // Large repositories are normal. Return a safe prefix so the caller
        // can narrow its next query instead of failing the whole operation.
        if (result.length >= maxEntries) return result
      }
    }
    return result
  }

  /**
   * Lists one directory page without recursively scanning the project. The
   * project may contain any number of files; limits apply only to this page.
   */
  async listDirectory(
    workspaceId: string,
    relativePath = '',
    offset = 0,
    limit = 200
  ): Promise<{ entries: WorkspaceFileEntry[]; nextOffset?: number }> {
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new WorkspaceError('LIMIT_EXCEEDED', '目录分页参数无效')
    }
    const directory = await this.resolveExisting(workspaceId, relativePath, 'directory', true)
    const root = this.requireGrant(workspaceId).realRootPath
    const base = relativePath ? normalizeWorkspaceRelativePath(relativePath) : ''
    const children = (await readdir(directory, { withFileTypes: true }))
      .filter((child) => {
        if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile())) return false
        const lower = child.name.toLocaleLowerCase('en-US')
        if (isBlockedName(lower)) return false
        return !(child.isDirectory() && IGNORED_GENERATED_DIRECTORIES.has(lower))
      })
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
        return left.name.localeCompare(right.name, 'en-US')
      })

    const page = children.slice(offset, offset + limit)
    const entries: WorkspaceFileEntry[] = []
    for (const child of page) {
      let safeRelative: string
      try {
        safeRelative = normalizeWorkspaceRelativePath(base ? `${base}/${child.name}` : child.name)
      } catch {
        continue
      }
      const absolute = resolve(root, safeRelative)
      if (!isPathInside(root, absolute)) continue
      const info = await lstat(absolute)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) {
        entries.push({ path: safeRelative.split(sep).join('/'), name: child.name, kind: 'directory' })
      } else if (info.isFile()) {
        entries.push({ path: safeRelative.split(sep).join('/'), name: child.name, kind: 'file', size: info.size })
      }
    }
    const nextOffset = offset + page.length
    return {
      entries,
      ...(nextOffset < children.length ? { nextOffset } : {})
    }
  }

  async readFile(workspaceId: string, relativePath: string): Promise<WorkspaceFileContent> {
    const normalized = normalizeWorkspaceRelativePath(relativePath)
    const target = await this.resolveExisting(workspaceId, normalized, 'file')
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    const handle = await open(target, flags)
    try {
      const before = await handle.stat()
      if (!before.isFile()) throw new WorkspaceError('NOT_FILE', '目标不是普通文件')
      if (before.size > WORKSPACE_LIMITS.maxSingleFileBytes) {
        throw new WorkspaceError('LIMIT_EXCEEDED', '单个文件超过 2MB 限制')
      }
      const content = await handle.readFile()
      await this.resolveExisting(workspaceId, normalized, 'file')
      if (isProbablyBinary(content)) throw new WorkspaceError('BINARY_FILE', '二进制文件不允许读取')
      let decoded: string
      try {
        // TextDecoder consumes an UTF-8 BOM by default. Validate with it, but
        // expose the Node decoding so the text remains byte-reproducible for
        // hash-bound edits and patches (including BOM and exact line endings).
        new TextDecoder('utf-8', { fatal: true }).decode(content)
        decoded = content.toString('utf8')
      } catch {
        throw new WorkspaceError('BINARY_FILE', '文件不是有效的 UTF-8 文本')
      }
      return {
        path: normalized.split(sep).join('/'),
        content: decoded,
        size: content.length,
        encoding: 'utf-8',
        hash: hashBuffer(content)
      }
    } finally {
      await handle.close()
    }
  }

  async saveFile(
    workspaceId: string,
    relativePath: string,
    content: string,
    expectedHash: string
  ): Promise<WorkspaceFileContent> {
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > WORKSPACE_LIMITS.maxSingleFileBytes) {
      throw new WorkspaceError('LIMIT_EXCEEDED', '文件内容超过 2MB 限制')
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(expectedHash)) throw new WorkspaceError('INVALID_PATH', '文件版本哈希无效')
    const normalized = normalizeWorkspaceRelativePath(relativePath)
    const target = await this.resolveExisting(workspaceId, normalized, 'file')
    const handle = await open(target, fsConstants.O_RDWR | (fsConstants.O_NOFOLLOW ?? 0))
    let original: Buffer
    try {
      const before = await handle.stat()
      if (!before.isFile()) throw new WorkspaceError('NOT_FILE', '目标不是普通文件')
      original = await handle.readFile()
      if (hashBuffer(original) !== expectedHash) {
        throw new WorkspaceError('ROOT_CHANGED', '文件已被其他操作修改，请重新打开后再保存')
      }
      const next = Buffer.from(content, 'utf8')
      try {
        await writeHandle(handle, next)
        await handle.sync()
      } catch (error) {
        await writeHandle(handle, original).catch(() => undefined)
        await handle.sync().catch(() => undefined)
        throw error
      }
    } finally {
      await handle.close()
    }
    const saved = await this.readFile(workspaceId, normalized)
    if (saved.content !== content) throw new WorkspaceError('ROOT_CHANGED', '保存后校验失败，请重新打开文件')
    return saved
  }

  async readMany(workspaceId: string, paths: string[]): Promise<WorkspaceFileContent[]> {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > WORKSPACE_LIMITS.maxReadManyFiles) {
      throw new WorkspaceError('LIMIT_EXCEEDED', '一次可读取 1 到 20 个文件')
    }
    const unique = [...new Set(paths)]
    if (unique.length !== paths.length) throw new WorkspaceError('INVALID_PATH', '文件路径不能重复')
    const result: WorkspaceFileContent[] = []
    let bytes = 0
    for (const path of unique) {
      const file = await this.readFile(workspaceId, path)
      bytes += file.size
      if (bytes > WORKSPACE_LIMITS.maxReadManyBytes) {
        throw new WorkspaceError('LIMIT_EXCEEDED', '批量读取总大小超过 5MB')
      }
      result.push(file)
    }
    return result
  }

  async searchText(
    workspaceId: string,
    query: string,
    relativePath = ''
  ): Promise<WorkspaceSearchMatch[]> {
    if (!query || query.length > WORKSPACE_LIMITS.maxQueryChars || CONTROL_CHARACTERS.test(query)) {
      throw new WorkspaceError('INVALID_PATH', '搜索关键词无效')
    }
    const files = await this.listFiles(workspaceId, relativePath)
    const matches: WorkspaceSearchMatch[] = []
    let scannedFiles = 0
    let scannedBytes = 0
    for (const entry of files) {
      if (entry.kind !== 'file') continue
      scannedFiles += 1
      scannedBytes += entry.size ?? 0
      if (
        scannedFiles > WORKSPACE_LIMITS.maxSearchFiles ||
        scannedBytes > WORKSPACE_LIMITS.maxSearchBytes
      ) break
      let file: WorkspaceFileContent
      try {
        file = await this.readFile(workspaceId, entry.path)
      } catch (error) {
        if (error instanceof WorkspaceError && ['BINARY_FILE', 'LIMIT_EXCEEDED'].includes(error.code)) continue
        throw error
      }
      const lines = file.content.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        const column = lines[index].indexOf(query)
        if (column < 0) continue
        matches.push({
          path: entry.path,
          line: index + 1,
          column: column + 1,
          preview: lines[index].slice(0, 500)
        })
        if (matches.length >= WORKSPACE_LIMITS.maxSearchResults) return matches
      }
    }
    return matches
  }

  async findFiles(
    workspaceId: string,
    query: string,
    relativePath = ''
  ): Promise<WorkspaceFileEntry[]> {
    if (!query || query.length > WORKSPACE_LIMITS.maxQueryChars || CONTROL_CHARACTERS.test(query)) {
      throw new WorkspaceError('INVALID_PATH', '文件搜索关键词无效')
    }
    const needle = query.toLocaleLowerCase('en-US')
    return (await this.listFiles(workspaceId, relativePath))
      .filter((entry) => entry.kind === 'file' && entry.path.toLocaleLowerCase('en-US').includes(needle))
      .slice(0, WORKSPACE_LIMITS.maxSearchResults)
  }

  private requireGrant(workspaceId: string): WorkspaceGrant {
    const grant = this.grants.get(workspaceId)
    if (!grant || grant.revoked) throw new WorkspaceError('UNKNOWN_WORKSPACE', '工作区授权不存在或已失效')
    return grant
  }

  private async resolveExisting(
    workspaceId: string,
    relativePath: string,
    expected: 'file' | 'directory',
    allowRoot = false
  ): Promise<string> {
    const grant = this.requireGrant(workspaceId)
    await this.verifyRoot(grant)
    const normalized = normalizeWorkspaceRelativePath(relativePath, allowRoot)
    const lexicalTarget = normalized ? resolve(grant.realRootPath, normalized) : grant.realRootPath
    if (!isPathInside(grant.realRootPath, lexicalTarget)) {
      throw new WorkspaceError('PATH_ESCAPE', '目标路径越过工作区边界')
    }

    let realTarget: string
    try {
      realTarget = await realpath(lexicalTarget)
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'ELOOP') throw new WorkspaceError('LINK_BLOCKED', '检测到循环链接')
      throw new WorkspaceError('NOT_FOUND', '目标路径不存在')
    }
    if (!isPathInside(grant.realRootPath, realTarget)) {
      throw new WorkspaceError('PATH_ESCAPE', '目标真实路径越过工作区边界')
    }

    const rel = relative(grant.realRootPath, lexicalTarget)
    let current = grant.realRootPath
    for (const segment of rel ? rel.split(sep) : []) {
      current = resolve(current, segment)
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new WorkspaceError('LINK_BLOCKED', '路径包含链接或联接点')
    }
    const info = await stat(realTarget)
    if (expected === 'file' && !info.isFile()) throw new WorkspaceError('NOT_FILE', '目标不是普通文件')
    if (expected === 'directory' && !info.isDirectory()) {
      throw new WorkspaceError('NOT_DIRECTORY', '目标不是目录')
    }
    return realTarget
  }

  private async verifyRoot(grant: WorkspaceGrant): Promise<void> {
    let rootInfo
    try {
      rootInfo = await lstat(grant.rootPath)
    } catch {
      throw new WorkspaceError('ROOT_CHANGED', '工作区根目录已失效')
    }
    if (
      !rootInfo.isDirectory() ||
      rootInfo.isSymbolicLink() ||
      !grant.rootIdentity ||
      identityOf(rootInfo) !== grant.rootIdentity
    ) {
      throw new WorkspaceError('ROOT_CHANGED', '工作区根目录在授权后被替换')
    }
    let currentRealRoot: string
    try {
      currentRealRoot = await realpath(grant.rootPath)
    } catch {
      throw new WorkspaceError('ROOT_CHANGED', '工作区根目录已失效')
    }
    if (canonical(currentRealRoot) !== canonical(grant.realRootPath)) {
      throw new WorkspaceError('ROOT_CHANGED', '工作区根目录在授权后发生变化')
    }
  }

  private persist(): void {
    this.storage.save([...this.grants.values()].map((grant) => ({ ...grant })))
  }
}
