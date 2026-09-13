import { createHash, createPublicKey, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginMarketEntry, PluginMarketOrigin } from '../../../shared/types'

const ORIGINS_FILE = 'plugin-origins.json'
const originMutationQueues = new Map<string, Promise<unknown>>()

export function marketOriginFromEntry(entry: PluginMarketEntry): PluginMarketOrigin {
  return {
    pluginVersion: entry.version,
    sourceId: entry.sourceId,
    sourceName: entry.sourceName,
    sourceKind: entry.sourceKind,
    verified: entry.verified,
    publisherId: publisherIdFromEntry(entry)
  }
}

export async function loadPluginMarketOrigins(dataRoot: string): Promise<Record<string, PluginMarketOrigin>> {
  try {
    const value = JSON.parse(await readFile(join(dataRoot, ORIGINS_FILE), 'utf8')) as unknown
    if (!record(value) || value.schemaVersion !== 1 || !record(value.origins)) return {}
    return Object.fromEntries(Object.entries(value.origins).flatMap(([id, origin]) => {
      const parsed = parseOrigin(origin)
      return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(id) && parsed ? [[id, parsed]] : []
    }))
  } catch { return {} }
}

export async function savePluginMarketOrigin(dataRoot: string, id: string, origin?: PluginMarketOrigin): Promise<void> {
  await replacePluginMarketOrigin(dataRoot, id, origin)
}

export async function replacePluginMarketOrigin(dataRoot: string, id: string, origin?: PluginMarketOrigin): Promise<PluginMarketOrigin | undefined> {
  return serializeOriginMutation(dataRoot, async () => {
    const origins = await loadPluginMarketOrigins(dataRoot)
    const previous = origins[id]
    if (origin) origins[id] = origin
    else delete origins[id]
    await writeAtomic(join(dataRoot, ORIGINS_FILE), JSON.stringify({ schemaVersion: 1, origins }))
    return previous
  })
}

export async function backupPluginMarketOrigin(dataRoot: string, id: string, version: string): Promise<void> {
  const origin = (await loadPluginMarketOrigins(dataRoot))[id]
  const path = join(dataRoot, 'plugin-history', id, `${version}.origin.json`)
  if (!origin) { await rm(path, { force: true }); return }
  await writeAtomic(path, JSON.stringify(origin))
}

export async function restorePluginMarketOrigin(dataRoot: string, id: string, version: string): Promise<PluginMarketOrigin | undefined> {
  const origin = await readPluginBackupOrigin(dataRoot, id, version)
  await savePluginMarketOrigin(dataRoot, id, origin)
  return origin
}

export async function readPluginBackupOrigin(dataRoot: string, id: string, version: string): Promise<PluginMarketOrigin | undefined> {
  try { return parseOrigin(JSON.parse(await readFile(join(dataRoot, 'plugin-history', id, `${version}.origin.json`), 'utf8')) as unknown) }
  catch { return undefined }
}

function publisherIdFromEntry(entry: PluginMarketEntry): string | undefined {
  if (entry.repository) return `github:${entry.repository.owner}/${entry.repository.repo}`
  if (!entry.signature || !entry.signingPublicKey) return undefined
  const der = createPublicKey(entry.signingPublicKey).export({ type: 'spki', format: 'der' })
  return `ed25519:${createHash('sha256').update(der).digest('hex')}`
}

function parseOrigin(value: unknown): PluginMarketOrigin | undefined {
  if (!record(value) || typeof value.pluginVersion !== 'string' || typeof value.sourceId !== 'string' || typeof value.sourceName !== 'string' ||
      !['official', 'community', 'github'].includes(String(value.sourceKind)) || typeof value.verified !== 'boolean' ||
      (value.publisherId !== undefined && typeof value.publisherId !== 'string')) return undefined
  return {
    pluginVersion: value.pluginVersion.slice(0, 64),
    sourceId: value.sourceId.slice(0, 200), sourceName: value.sourceName.slice(0, 100),
    sourceKind: value.sourceKind as PluginMarketOrigin['sourceKind'], verified: value.sourceKind === 'official' && value.verified,
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
