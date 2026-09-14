import { createHash, createPublicKey, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginImportKind, PluginInstallOrigin, PluginMarketEntry } from '../../../shared/types'

const ORIGINS_FILE = 'plugin-origins.json'
const originMutationQueues = new Map<string, Promise<unknown>>()

export function installOriginFromMarketEntry(entry: PluginMarketEntry): PluginInstallOrigin {
  return {
    pluginVersion: entry.version,
    sourceId: entry.sourceId,
    sourceName: entry.sourceName,
    sourceKind: entry.sourceKind,
    verified: entry.verified,
    publisherId: publisherIdFromEntry(entry)
  }
}

export function createLocalInstallOrigin(pluginVersion: string | undefined, kind: PluginImportKind): PluginInstallOrigin {
  return {
    pluginVersion,
    sourceId: `local:${kind}`,
    sourceName: kind === 'zip' ? '本地 ZIP' : '本地文件夹',
    sourceKind: 'local',
    verified: false
  }
}

export async function loadPluginInstallOrigins(dataRoot: string): Promise<Record<string, PluginInstallOrigin>> {
  try {
    const value = JSON.parse(await readFile(join(dataRoot, ORIGINS_FILE), 'utf8')) as unknown
    if (!record(value) || value.schemaVersion !== 1 || !record(value.origins)) return {}
    return Object.fromEntries(Object.entries(value.origins).flatMap(([id, origin]) => {
      const parsed = parseOrigin(origin)
      return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(id) && parsed ? [[id, parsed]] : []
    }))
  } catch { return {} }
}

export async function savePluginInstallOrigin(dataRoot: string, id: string, origin?: PluginInstallOrigin): Promise<void> {
  await replacePluginInstallOrigin(dataRoot, id, origin)
}

export async function replacePluginInstallOrigin(dataRoot: string, id: string, origin?: PluginInstallOrigin): Promise<PluginInstallOrigin | undefined> {
  return serializeOriginMutation(dataRoot, async () => {
    const origins = await loadPluginInstallOrigins(dataRoot)
    const previous = origins[id]
    if (origin) origins[id] = origin
    else delete origins[id]
    await writeAtomic(join(dataRoot, ORIGINS_FILE), JSON.stringify({ schemaVersion: 1, origins }))
    return previous
  })
}

export async function backupPluginInstallOrigin(dataRoot: string, id: string, version: string): Promise<void> {
  const origin = (await loadPluginInstallOrigins(dataRoot))[id]
  const path = join(dataRoot, 'plugin-history', id, `${version}.origin.json`)
  if (!origin) { await rm(path, { force: true }); return }
  await writeAtomic(path, JSON.stringify(origin))
}

export async function restorePluginInstallOrigin(dataRoot: string, id: string, version: string): Promise<PluginInstallOrigin | undefined> {
  const origin = await readPluginBackupOrigin(dataRoot, id, version)
  await savePluginInstallOrigin(dataRoot, id, origin)
  return origin
}

export async function readPluginBackupOrigin(dataRoot: string, id: string, version: string): Promise<PluginInstallOrigin | undefined> {
  try { return parseOrigin(JSON.parse(await readFile(join(dataRoot, 'plugin-history', id, `${version}.origin.json`), 'utf8')) as unknown) }
  catch { return undefined }
}

function publisherIdFromEntry(entry: PluginMarketEntry): string | undefined {
  if (entry.repository) return `github:${entry.repository.owner}/${entry.repository.repo}`
  if (!entry.signature || !entry.signingPublicKey) return undefined
  const der = createPublicKey(entry.signingPublicKey).export({ type: 'spki', format: 'der' })
  return `ed25519:${createHash('sha256').update(der).digest('hex')}`
}

function parseOrigin(value: unknown): PluginInstallOrigin | undefined {
  if (!record(value) || (value.pluginVersion !== undefined && typeof value.pluginVersion !== 'string') ||
      typeof value.sourceId !== 'string' || typeof value.sourceName !== 'string' ||
      !['official', 'community', 'github', 'local'].includes(String(value.sourceKind)) || typeof value.verified !== 'boolean' ||
      (value.publisherId !== undefined && typeof value.publisherId !== 'string')) return undefined
  return {
    pluginVersion: typeof value.pluginVersion === 'string' ? value.pluginVersion.slice(0, 64) : undefined,
    sourceId: value.sourceId.slice(0, 200), sourceName: value.sourceName.slice(0, 100),
    sourceKind: value.sourceKind as PluginInstallOrigin['sourceKind'], verified: value.sourceKind === 'official' && value.verified,
    publisherId: typeof value.publisherId === 'string' ? value.publisherId.slice(0, 200) : undefined
  }
}


function serializeOriginMutation<T>(dataRoot: string, action: () => Promise<T>): Promise<T> {
  const previous = originMutationQueues.get(dataRoot) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(action)
  originMutationQueues.set(dataRoot, current)
  void current.finally(() => { if (originMutationQueues.get(dataRoot) === current) originMutationQueues.delete(dataRoot) }).catch(() => undefined)
  return current
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
  try { await rename(temporary, path) } finally { await rm(temporary, { force: true }).catch(() => undefined) }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
