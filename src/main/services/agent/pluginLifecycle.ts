import { createHash, randomUUID, verify } from 'node:crypto'
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginBackup, PluginMarketEntry, PluginMetadata } from '../../../shared/types'
import { importPluginPackage } from './pluginInstaller'
import { readPluginManifest } from './pluginManifest'

const MAX_DOWNLOAD = 25 * 1024 * 1024

export async function installMarketPlugin(entry: PluginMarketEntry, dataRoot: string, installedRoot: string, fetcher = fetch): Promise<PluginMetadata> {
  if (entry.platforms.length && !entry.platforms.includes(process.platform)) throw new Error('插件不支持当前操作系统')
  if (entry.architectures.length && !entry.architectures.includes(process.arch)) throw new Error('插件不支持当前处理器架构')
  if (entry.minAppVersion && compareSemver(process.env.npm_package_version ?? '0.1.0', entry.minAppVersion) < 0) throw new Error('当前应用版本不满足插件要求')
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
