import { createHash, randomUUID, verify } from 'node:crypto'
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { PluginBackup, PluginMarketEntry, PluginMetadata } from '../../../shared/types'
import { importPluginPackage } from './pluginInstaller'
import { readPluginManifest } from './pluginManifest'

const MAX_DOWNLOAD = 25 * 1024 * 1024
const MAX_FILE = 5 * 1024 * 1024
const MAX_FILES = 1_000

export async function installMarketPlugin(entry: PluginMarketEntry, dataRoot: string, installedRoot: string, fetcher = fetch): Promise<PluginMetadata> {
  if (entry.installable === false) throw new Error(entry.unavailableReason ?? '此插件当前不可安装')
  if (entry.platforms.length && !entry.platforms.includes(process.platform)) throw new Error('插件不支持当前操作系统')
  if (entry.architectures.length && !entry.architectures.includes(process.arch)) throw new Error('插件不支持当前处理器架构')
  if (entry.minAppVersion && compareSemver(process.env.npm_package_version ?? '0.1.0', entry.minAppVersion) < 0) throw new Error('当前应用版本不满足插件要求')
  if (entry.repository) return installRepositoryPlugin(entry, dataRoot, installedRoot, fetcher)
  if (!entry.packageUrl || !entry.sha256) throw new Error('市场插件缺少可验证的下载信息')
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000)
  let response: Response
  try { response = await fetcher(entry.packageUrl, { signal: controller.signal, redirect: 'error' }) } finally { clearTimeout(timer) }
  if (!response.ok) throw new Error(`插件下载失败（HTTP ${response.status}）`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_DOWNLOAD) throw new Error('插件下载超过大小限制')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_DOWNLOAD) throw new Error('插件下载超过大小限制')
  verifyPluginArchive(bytes, entry.sha256)
  verifyPluginSignature(bytes, entry)
  const downloads = join(dataRoot, 'plugin-downloads')
  await mkdir(downloads, { recursive: true })
  const archive = join(downloads, `${randomUUID()}.zip`)
  try {
    await writeFile(archive, bytes, { flag: 'wx', mode: 0o600 })
    await backupInstalledPlugin(entry.id, dataRoot, installedRoot)
    return await importPluginPackage(installedRoot, archive, {
      expectedId: entry.id,
      expectedVersion: entry.version
    })
  } finally { await rm(archive, { force: true }).catch(() => undefined) }
}

async function installRepositoryPlugin(
  entry: PluginMarketEntry,
  dataRoot: string,
  installedRoot: string,
  fetcher: typeof fetch
): Promise<PluginMetadata> {
  const repository = entry.repository
  if (!repository || repository.owner !== 'openai' || repository.repo !== 'plugins' ||
      !/^[a-f0-9]{40}$/.test(repository.ref) || !/^plugins\/[a-z0-9][a-z0-9._-]{1,63}$/.test(repository.path)) {
    throw new Error('官方插件仓库位置无效')
  }
  const treeUrl = `https://api.github.com/repos/${repository.owner}/${repository.repo}/git/trees/${repository.ref}?recursive=1`
  const treeResponse = await fetchWithTimeout(fetcher, treeUrl, { headers: { Accept: 'application/vnd.github+json' }, redirect: 'error' })
  if (!treeResponse.ok) throw new Error(`读取官方插件目录失败（HTTP ${treeResponse.status}）`)
  const treeBytes = Buffer.from(await treeResponse.arrayBuffer())
  if (treeBytes.byteLength > 5 * 1024 * 1024) throw new Error('官方插件目录索引超过大小限制')
  const tree = JSON.parse(treeBytes.toString('utf8')) as unknown
  if (!record(tree) || !Array.isArray(tree.tree) || tree.truncated === true) throw new Error('官方插件目录索引不完整')
  const prefix = `${repository.path}/`
  const files = tree.tree.filter((item): item is Record<string, unknown> => record(item) && item.type === 'blob' &&
    typeof item.path === 'string' && item.path.startsWith(prefix))
  if (!files.length || files.length > MAX_FILES) throw new Error('官方插件文件数量无效')
  let total = 0
  for (const file of files) {
    const size = Number(file.size)
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE) throw new Error('官方插件包含超限文件')
    if (file.mode === '120000') throw new Error('官方插件不能包含符号链接')
    total += size
    if (total > MAX_DOWNLOAD) throw new Error('官方插件包总大小超过限制')
  }

  const downloads = join(dataRoot, 'plugin-downloads')
  const stage = join(downloads, `repository-${randomUUID()}`)
  await mkdir(stage, { recursive: true })
  try {
    for (const file of files) {
      const sourcePath = String(file.path)
      const relativePath = sourcePath.slice(prefix.length)
      const target = resolve(stage, ...relativePath.split('/'))
      if (!relativePath || isAbsolute(relativePath) || relative(stage, target).startsWith('..')) throw new Error('官方插件包含越界路径')
      const rawUrl = `https://raw.githubusercontent.com/${repository.owner}/${repository.repo}/${repository.ref}/${sourcePath}`
      const response = await fetchWithTimeout(fetcher, rawUrl, { redirect: 'error' })
      if (!response.ok) throw new Error(`下载官方插件文件失败（HTTP ${response.status}）`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.byteLength !== Number(file.size) || bytes.byteLength > MAX_FILE) throw new Error('官方插件文件大小校验失败')
      const expectedSha = typeof file.sha === 'string' ? file.sha : ''
      const actualSha = createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
      if (!/^[a-f0-9]{40}$/.test(expectedSha) || actualSha !== expectedSha) throw new Error('官方插件文件摘要校验失败')
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
    }
    await backupInstalledPlugin(entry.id, dataRoot, installedRoot)
    return await importPluginPackage(installedRoot, stage, {
      expectedId: entry.id,
      expectedVersion: entry.version === '0.0.0' ? undefined : entry.version
    })
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function backupInstalledPlugin(id: string, dataRoot: string, installedRoot: string): Promise<void> {
  const current = join(installedRoot, id)
  let manifest
  try { manifest = await readPluginManifest(current) } catch { return }
  if (!manifest.version) return
  const destination = join(dataRoot, 'plugin-history', id, manifest.version)
  await rm(destination, { recursive: true, force: true })
  await mkdir(join(destination, '..'), { recursive: true })
  await cp(current, destination, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
}

export async function listPluginBackups(id: string, dataRoot: string): Promise<PluginBackup[]> {
  const root = join(dataRoot, 'plugin-history', id)
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const results = await Promise.all(entries.filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+/.test(entry.name)).map(async (entry) => ({
      pluginId: id, version: entry.name, createdAt: (await stat(join(root, entry.name))).mtimeMs
    })))
    return results.sort((a, b) => b.createdAt - a.createdAt)
  } catch { return [] }
}

export async function rollbackPlugin(id: string, version: string, dataRoot: string, installedRoot: string): Promise<PluginMetadata> {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('回滚版本无效')
  const source = join(dataRoot, 'plugin-history', id, version)
  const manifest = await readPluginManifest(source)
  if (manifest.id !== id || manifest.version !== version) throw new Error('回滚包身份无效')
  return importPluginPackage(installedRoot, source)
}

export function verifyPluginArchive(bytes: Buffer, expected: string): void {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected.toLowerCase()) throw new Error('插件包摘要校验失败')
}

export function verifyPluginSignature(bytes: Buffer, entry: Pick<PluginMarketEntry, 'signature' | 'signingPublicKey'>): void {
  if (!entry.signature) return
  if (!entry.signingPublicKey) throw new Error('插件签名缺少可信公钥')
  let signature: Buffer
  try { signature = Buffer.from(entry.signature, 'base64') } catch { throw new Error('插件签名格式无效') }
  if (!signature.length || !verify(null, bytes, entry.signingPublicKey, signature)) throw new Error('插件签名校验失败')
}

function compareSemver(left: string, right: string): number {
  const parse = (value: string): number[] => value.split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0)
  const a = parse(left), b = parse(right)
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index]
  return 0
}

async function fetchWithTimeout(fetcher: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try { return await fetcher(url, { ...init, signal: controller.signal }) }
  finally { clearTimeout(timer) }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
