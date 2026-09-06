import { constants as fsConstants } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { SandboxChangeManifest, SandboxFileChange } from '../../../shared/agent'

const MAX_FILES = 5_000
const MAX_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_SINGLE_FILE_BYTES = 16 * 1024 * 1024
const MAX_DEPTH = 20
const MAX_RUNTIME_ENTRIES = 10_000
const MAX_RUNTIME_BYTES = 256 * 1024 * 1024
const BLOCKED_DIRECTORIES = new Set([
  '.git', '.ssh', '.gnupg', 'node_modules', 'dist', 'build', 'out', 'release',
  'coverage', '.next', '.nuxt', '.cache', '.turbo', '.vite', 'target'
])
const BLOCKED_FILES = new Set([
  '.npmrc', '.pypirc', '.netrc', 'credentials', 'credentials.json',
  'id_rsa', 'id_ed25519', 'known_hosts'
])

export interface DockerWorkspaceCopy {
  rootPath: string
  fileCount: number
  totalBytes: number
  skippedEntries: number
  baseline?: Record<string, { hash: string; size: number; text?: string }>
}

/** Creates a disposable ordinary-file-only copy. The source project is never mounted into Docker. */
export async function createDockerWorkspaceCopy(
  sourceRoot: string,
  runtimeRoot: string
): Promise<DockerWorkspaceCopy> {
  const sourceInfo = await lstat(sourceRoot)
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error('DOCKER_WORKSPACE_ROOT_INVALID')
  const realSource = await realpath(sourceRoot)
  const rootPath = join(runtimeRoot, `workspace-${randomUUID()}`)
  await mkdir(rootPath, { recursive: true, mode: 0o700 })
  const result: DockerWorkspaceCopy = {
    rootPath, fileCount: 0, totalBytes: 0, skippedEntries: 0, baseline: Object.create(null)
  }
  try {
    const queue: Array<{ source: string; destination: string; depth: number }> = [
      { source: realSource, destination: rootPath, depth: 0 }
    ]
    while (queue.length) {
      const current = queue.shift()!
      if (current.depth > MAX_DEPTH) throw new Error('DOCKER_WORKSPACE_DEPTH_LIMIT')
      const entries = await readdir(current.source, { withFileTypes: true })
      for (const entry of entries) {
        if (unsafeName(entry.name)) { result.skippedEntries += 1; continue }
        const source = resolve(current.source, entry.name)
        const sourceRelative = relative(realSource, source)
        if (!sourceRelative || sourceRelative === '..' || sourceRelative.startsWith(`..${sep}`)) {
          throw new Error('DOCKER_WORKSPACE_PATH_ESCAPE')
        }
        const destination = resolve(current.destination, entry.name)
        const info = await lstat(source)
        if (info.isSymbolicLink()) { result.skippedEntries += 1; continue }
        if (info.isDirectory()) {
          if (BLOCKED_DIRECTORIES.has(entry.name.toLowerCase())) { result.skippedEntries += 1; continue }
          await mkdir(destination, { mode: 0o700 })
          queue.push({ source, destination, depth: current.depth + 1 })
          continue
        }
        if (!info.isFile()) { result.skippedEntries += 1; continue }
        if (info.size > MAX_SINGLE_FILE_BYTES) throw new Error('DOCKER_WORKSPACE_FILE_TOO_LARGE')
        if (result.fileCount + 1 > MAX_FILES || result.totalBytes + info.size > MAX_TOTAL_BYTES) {
          throw new Error('DOCKER_WORKSPACE_COPY_LIMIT')
        }
        const handle = await open(source, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
        try {
          const before = await handle.stat()
          if (!before.isFile() || before.dev !== info.dev || before.ino !== info.ino) {
            throw new Error('DOCKER_WORKSPACE_SOURCE_CHANGED')
          }
          const content = await handle.readFile()
          const after = await handle.stat()
          if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || content.length !== before.size) {
            throw new Error('DOCKER_WORKSPACE_SOURCE_CHANGED')
          }
          await writeFile(destination, content, { flag: 'wx', mode: 0o600 })
          result.baseline![sourceRelative.replaceAll('\\', '/')] = fileSnapshot(content)
          result.fileCount += 1
          result.totalBytes += content.length
        } finally { await handle.close() }
      }
    }
    await makeContainerWritable(rootPath)
    return result
  } catch (error) {
    await rm(rootPath, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

/** Compares the disposable sandbox with its immutable baseline before deletion. */
export async function collectDockerWorkspaceChanges(copy: DockerWorkspaceCopy): Promise<SandboxChangeManifest> {
  const baseline = copy.baseline ?? Object.create(null) as Record<string, { hash: string; size: number; text?: string }>
  const current: Record<string, { hash: string; size: number; text?: string }> = Object.create(null)
  const queue: Array<{ path: string; relativePath: string; depth: number }> = [
    { path: copy.rootPath, relativePath: '', depth: 0 }
  ]
  let entries = 0
  let bytes = 0
  while (queue.length) {
    const item = queue.shift()!
    if (item.depth > MAX_DEPTH) throw new Error('DOCKER_WORKSPACE_OUTPUT_LIMIT')
    for (const entry of await readdir(item.path, { withFileTypes: true })) {
      if (unsafeName(entry.name)) throw new Error('DOCKER_WORKSPACE_UNSAFE_OUTPUT')
      const target = resolve(item.path, entry.name)
      const targetRelative = relative(copy.rootPath, target)
      if (!targetRelative || targetRelative === '..' || targetRelative.startsWith(`..${sep}`)) {
        throw new Error('DOCKER_WORKSPACE_PATH_ESCAPE')
      }
      const info = await lstat(target)
      entries += 1
      if (entries > MAX_RUNTIME_ENTRIES || info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
        throw new Error('DOCKER_WORKSPACE_UNSAFE_OUTPUT')
      }
      const normalized = targetRelative.replaceAll('\\', '/')
      if (info.isDirectory()) {
        queue.push({ path: target, relativePath: normalized, depth: item.depth + 1 })
        continue
      }
      bytes += info.size
      if (info.size > MAX_SINGLE_FILE_BYTES || bytes > MAX_RUNTIME_BYTES) {
        throw new Error('DOCKER_WORKSPACE_OUTPUT_LIMIT')
      }
      const handle = await open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      try {
        const content = await handle.readFile()
        current[normalized] = fileSnapshot(content)
      } finally { await handle.close() }
    }
  }

  const changes: SandboxFileChange[] = []
  let added = 0
  let modified = 0
  let deleted = 0
  let diffBytes = 0
  let truncated = false
  const paths = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()
  for (const path of paths) {
    const before = baseline[path]
    const after = current[path]
    if (before?.hash === after?.hash) continue
    const status = !before ? 'added' : !after ? 'deleted' : 'modified'
    if (status === 'added') added += 1
    else if (status === 'modified') modified += 1
    else deleted += 1
    if (changes.length >= 500) { truncated = true; continue }
    let diff = textDiff(path, before?.text, after?.text)
    if (diff) {
      const available = 256 * 1024 - diffBytes
      if (available <= 0) { diff = undefined; truncated = true }
      else if (Buffer.byteLength(diff, 'utf8') > available) {
        diff = Buffer.from(diff, 'utf8').subarray(0, available).toString('utf8')
        truncated = true
      }
      if (diff) diffBytes += Buffer.byteLength(diff, 'utf8')
    }
    changes.push({
      path, status, beforeHash: before?.hash, afterHash: after?.hash,
      size: after?.size, diff
    })
  }
  return { files: changes, added, modified, deleted, truncated }
}

export async function removeDockerWorkspaceCopy(copy: DockerWorkspaceCopy): Promise<void> {
  await rm(copy.rootPath, { recursive: true, force: true })
}

/** Bounded post-copy scan used while a container is running to stop uncontrolled disk growth. */
export async function assertDockerWorkspaceUsage(rootPath: string): Promise<void> {
  const queue: Array<{ path: string; depth: number }> = [{ path: rootPath, depth: 0 }]
  let entries = 0
  let bytes = 0
  while (queue.length) {
    const current = queue.shift()!
    if (current.depth > MAX_DEPTH) throw new Error('DOCKER_WORKSPACE_OUTPUT_LIMIT')
    for (const entry of await readdir(current.path, { withFileTypes: true })) {
      const target = join(current.path, entry.name)
      const info = await lstat(target)
      entries += 1
      if (entries > MAX_RUNTIME_ENTRIES || info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
        throw new Error('DOCKER_WORKSPACE_OUTPUT_LIMIT')
      }
      if (info.isDirectory()) queue.push({ path: target, depth: current.depth + 1 })
      else {
        bytes += info.size
        if (bytes > MAX_RUNTIME_BYTES) throw new Error('DOCKER_WORKSPACE_OUTPUT_LIMIT')
      }
    }
  }
}

function unsafeName(name: string): boolean {
  const lower = name.toLowerCase()
  return !name || /[\u0000-\u001f\u007f]/.test(name) || lower === '.env' || lower.startsWith('.env.') ||
    BLOCKED_FILES.has(lower) || /\.(?:pem|key|p12|pfx)$/i.test(lower)
}

function fileSnapshot(content: Buffer): { hash: string; size: number; text?: string } {
  const hash = `sha256:${createHash('sha256').update(content).digest('hex')}`
  let text: string | undefined
  if (content.length <= 128 * 1024 && !content.includes(0)) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(content) } catch { /* Binary output: hashes only. */ }
  }
  return { hash, size: content.length, text }
}

function textDiff(path: string, before?: string, after?: string): string | undefined {
  if (before === undefined && after === undefined) return undefined
  const oldLines = before?.split('\n') ?? []
  const newLines = after?.split('\n') ?? []
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`)
  ].join('\n')
}

async function makeContainerWritable(rootPath: string): Promise<void> {
  const queue = [rootPath]
  while (queue.length) {
    const current = queue.shift()!
    const info = await lstat(current)
    if (info.isDirectory()) {
      await chmod(current, 0o777)
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (!entry.isSymbolicLink()) queue.push(join(current, entry.name))
      }
    } else if (info.isFile()) await chmod(current, 0o666)
  }
}
