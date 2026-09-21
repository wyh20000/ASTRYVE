import { randomUUID } from 'node:crypto'
import {
  copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile
} from 'node:fs/promises'
import { basename, extname, isAbsolute, join, posix, relative, resolve, win32 } from 'node:path'
import JSZip, { type JSZipObject } from 'jszip'
import type { PluginComponent, PluginMetadata, PluginPermission } from '../../../shared/types'
import { readPluginManifest, type ParsedPluginManifest } from './pluginManifest'
import { readPluginMcpDeclarations } from './pluginMcpManifest'
import { readPluginUiDocument } from './pluginUiContent'

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 25 * 1024 * 1024
const MAX_FILES = 1_000
const MAX_COMPRESSION_RATIO = 100
const FORBIDDEN_DIRECTORIES = new Set(['.git', 'node_modules'])
const NATIVE_EXECUTABLES = new Set(['.exe', '.dll', '.node', '.msi', '.com', '.scr'])

interface ImportBudget { files: number; entries: number; bytes: number }
export interface PluginImportExpectations {
  expectedId?: string
  expectedVersion?: string
  expectedAuthor?: string
  expectedPermissions?: PluginPermission[]
  expectedCapabilities?: string[]
  expectedDataTargets?: string[]
  expectedComponents?: PluginComponent[]
  beforeReplace?: (manifest: ParsedPluginManifest) => Promise<void>
}

export async function importPluginPackage(
  installedRoot: string,
  source: string,
  expectations: PluginImportExpectations = {}
): Promise<PluginMetadata> {
  const installed = resolve(installedRoot)
  const input = resolve(source)
  if (isWithin(input, installed)) throw new Error('不能从插件安装目录内重复导入')
  const sourceInfo = await lstat(input)
  if (sourceInfo.isSymbolicLink()) throw new Error('导入来源不允许符号链接')
  await mkdir(installed, { recursive: true })
  const stage = join(installed, `.staging-${randomUUID()}`)
  await mkdir(stage)
  try {
    if (sourceInfo.isDirectory()) await copyDirectory(input, stage, { files: 0, entries: 0, bytes: 0 }, 0)
    else if (sourceInfo.isFile() && extname(input).toLowerCase() === '.zip') await extractZip(input, stage)
    else throw new Error('请选择插件文件夹或 ZIP 文件')

    const packageRoot = await locatePackageRoot(stage)
    const parsed = await readPluginManifest(packageRoot)
    if (parsed.mcpPath) await readPluginMcpDeclarations(packageRoot, parsed.mcpPath)
    if (parsed.uiPath) await readPluginUiDocument(packageRoot, parsed.uiPath)
    if ((expectations.expectedId && parsed.id !== expectations.expectedId) ||
        (expectations.expectedVersion && parsed.version !== expectations.expectedVersion)) {
      throw new Error('下载包身份与市场索引不一致')
    }
    if ((expectations.expectedAuthor && parsed.author !== expectations.expectedAuthor) ||
        (expectations.expectedPermissions && !sameStrings(parsed.permissions, expectations.expectedPermissions)) ||
        (expectations.expectedCapabilities && !sameStrings(parsed.capabilities, expectations.expectedCapabilities)) ||
        (expectations.expectedDataTargets && !sameStrings(parsed.dataTargets ?? [], expectations.expectedDataTargets)) ||
        (expectations.expectedComponents && !sameStrings(parsed.components, expectations.expectedComponents))) {
      throw new Error('下载包清单与市场展示不一致')
    }
    await expectations.beforeReplace?.(parsed)
    const destination = join(installed, parsed.id)
    await assertIdAvailable(installed, destination, parsed.id)
    await replacePluginDirectoryAtomically(stage, packageRoot, destination, parsed.id)
    return {
      ...parsed, source: 'installed', enabled: true, status: 'ready', errors: []
    }
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function copyDirectory(source: string, destination: string, budget: ImportBudget, depth: number): Promise<void> {
  if (depth > 32) throw new Error('插件包目录层级超过限制')
  for (const entry of await readdir(source, { withFileTypes: true })) {
    budget.entries += 1
    if (budget.entries > MAX_FILES) throw new Error('插件包文件数量超过限制')
    if (FORBIDDEN_DIRECTORIES.has(entry.name)) throw new Error(`插件包不允许包含 ${entry.name}`)
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    const info = await lstat(from)
    if (info.isSymbolicLink()) throw new Error('插件包不允许符号链接或目录联接')
    if (info.isDirectory()) {
      await mkdir(to)
      await copyDirectory(from, to, budget, depth + 1)
    } else if (info.isFile()) {
      validateFile(entry.name, info.size, budget)
      await copyFile(from, to)
    } else throw new Error('插件包包含不支持的文件类型')
  }
}

async function extractZip(source: string, destination: string): Promise<void> {
  const archive = await readFile(source)
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('ZIP 文件超过限制')
  const zip = await JSZip.loadAsync(archive)
  const budget: ImportBudget = { files: 0, entries: 0, bytes: 0 }
  for (const entry of Object.values(zip.files)) {
    const original = entry.unsafeOriginalName ?? entry.name
    const safeName = validateArchiveName(original)
    if (entry.dir) {
      budget.entries += 1
      if (budget.entries > MAX_FILES) throw new Error('插件包文件数量超过限制')
      if (safeName !== '.') await mkdir(join(destination, ...safeName.split('/')), { recursive: true })
      continue
    }
    rejectZipLink(entry)
    const declared = await zipSizes(entry)
    if (declared.uncompressed > MAX_FILE_BYTES) throw new Error('插件包单个文件超过限制')
    if (declared.compressed > 0 && declared.uncompressed / declared.compressed > MAX_COMPRESSION_RATIO) {
      throw new Error('ZIP 压缩比超过安全限制')
    }
    validateFile(posix.basename(safeName), declared.uncompressed, budget)
    const target = join(destination, ...safeName.split('/'))
    await mkdir(join(target, '..'), { recursive: true })
    const content = await entry.async('nodebuffer')
    if (content.byteLength !== declared.uncompressed) {
      budget.bytes += content.byteLength - declared.uncompressed
      if (content.byteLength > MAX_FILE_BYTES || budget.bytes > MAX_TOTAL_BYTES) throw new Error('插件包解压后超过限制')
    }
    await writeFile(target, content, { flag: 'wx' })
  }
}

function validateArchiveName(name: string): string {
  const slashName = name.replace(/\\/g, '/')
  const normalized = posix.normalize(slashName)
  const first = normalized.split('/')[0]
  if (!slashName || slashName.startsWith('/') || isAbsolute(slashName) || win32.isAbsolute(slashName) ||
      normalized === '..' || normalized.startsWith('../') || entryEscaped(name, normalized)) {
    throw new Error('ZIP 包含越界路径')
  }
  if (normalized.split('/').some((part) => part.includes(':'))) throw new Error('ZIP 包含无效路径')
  if (FORBIDDEN_DIRECTORIES.has(first) || normalized.split('/').some((part) => FORBIDDEN_DIRECTORIES.has(part))) {
    throw new Error('插件包包含不允许的目录')
  }
  return normalized
}

function entryEscaped(original: string, normalized: string): boolean {
  const unsafe = original.replace(/\\/g, '/').split('/').some((part) => part === '..')
  return unsafe || normalized.includes('\0')
}

function rejectZipLink(entry: JSZipObject): void {
  const mode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0
  if ((mode & 0o170000) === 0o120000) throw new Error('插件包不允许符号链接或目录联接')
}

async function zipSizes(entry: JSZipObject): Promise<{ compressed: number; uncompressed: number }> {
  const raw = (entry as unknown as { _data?: unknown })._data
  if (raw && typeof (raw as PromiseLike<unknown>).then === 'function') {
    const empty = await (raw as PromiseLike<unknown>)
    if (empty === '' || (Buffer.isBuffer(empty) && empty.byteLength === 0)) return { compressed: 0, uncompressed: 0 }
  }
  const data = raw as { compressedSize?: number; uncompressedSize?: number } | undefined
  const compressed = Number(data?.compressedSize)
  const uncompressed = Number(data?.uncompressedSize)
  if (!Number.isSafeInteger(compressed) || compressed < 0 || !Number.isSafeInteger(uncompressed) || uncompressed < 0) {
    throw new Error('ZIP 文件大小信息无效')
  }
  return { compressed, uncompressed }
}

function validateFile(name: string, size: number, budget: ImportBudget): void {
  if (NATIVE_EXECUTABLES.has(extname(name).toLowerCase())) throw new Error('插件包不允许导入原生可执行文件')
  if (size > MAX_FILE_BYTES) throw new Error('插件包单个文件超过限制')
  budget.files += 1
  budget.entries += 1
  budget.bytes += size
  if (budget.entries > MAX_FILES) throw new Error('插件包文件数量超过限制')
  if (budget.bytes > MAX_TOTAL_BYTES) throw new Error('插件包总大小超过限制')
}

async function locatePackageRoot(stage: string): Promise<string> {
  if (await hasManifest(stage)) return stage
  const candidates: string[] = []
  for (const entry of await readdir(stage, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const candidate = join(stage, entry.name)
      if (await hasManifest(candidate)) candidates.push(candidate)
    }
  }
  if (candidates.length !== 1) throw new Error(candidates.length ? '插件包包含多个清单根目录' : '插件包根目录未找到清单')
  return candidates[0]
}

async function hasManifest(root: string): Promise<boolean> {
  return (await existsFile(join(root, 'plugin.json'))) || (await existsFile(join(root, '.codex-plugin', 'plugin.json')))
}

async function existsFile(path: string): Promise<boolean> {
  try { return (await lstat(path)).isFile() } catch { return false }
}

async function assertIdAvailable(installedRoot: string, destination: string, id: string): Promise<void> {
  for (const entry of await readdir(installedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue
    const candidate = join(installedRoot, entry.name)
    try {
      const parsed = await readPluginManifest(candidate)
      if (parsed.id === id && resolve(candidate).toLowerCase() !== resolve(destination).toLowerCase()) {
        throw new Error('插件标识已由其他目录占用')
      }
    } catch (error) {
      if (error instanceof Error && error.message === '插件标识已由其他目录占用') throw error
    }
  }
  try {
    const info = await lstat(destination)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('插件目标目录无效')
    const current = await readPluginManifest(destination).catch(() => undefined)
    if (!current || current.id !== id) throw new Error('插件目标目录已被其他内容占用')
  } catch (error) {
    if (error instanceof Error && (error.message === '插件目标目录无效' || error.message === '插件目标目录已被其他内容占用')) throw error
  }
}

export async function replacePluginDirectoryAtomically(
  stage: string,
  packageRoot: string,
  destination: string,
  id: string,
  renamePath: (from: string, to: string) => Promise<void> = rename
): Promise<void> {
  const backup = join(resolve(destination, '..'), `.backup-${id}-${randomUUID()}`)
  let hasBackup = false
  try {
    await lstat(destination)
    await renamePath(destination, backup)
    hasBackup = true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }
  try {
    await renamePath(packageRoot, destination)
  } catch (error) {
    if (hasBackup) await renamePath(backup, destination).catch(() => undefined)
    throw error
  }
  if (packageRoot !== stage) await rm(stage, { recursive: true, force: true }).catch(() => undefined)
  if (hasBackup) await rm(backup, { recursive: true, force: true }).catch(() => undefined)
}

function isWithin(child: string, parent: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index])
}
