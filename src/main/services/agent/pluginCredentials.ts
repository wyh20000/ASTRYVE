import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PluginConnectionStore } from './pluginConnectionStore'
import type { PluginDataDisposition } from './pluginUninstall'

const FILE = 'plugin-credentials.json'
const MAX_FILE_BYTES = 512 * 1024
const MAX_PLAINTEXT_BYTES = 64 * 1024
const MAX_CIPHERTEXT_BYTES = 128 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/
const queues = new Map<string, Promise<unknown>>()

export type PluginCredentialKind = 'api-key' | 'access-token' | 'refresh-token'

export interface CredentialEncryptionAdapter {
  available(): Promise<boolean>
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<string>
}

interface PersistedCredentials {
  secrets: Record<string, Partial<Record<PluginCredentialKind, string>>>
}

const electronEncryption: CredentialEncryptionAdapter = {
  async available() {
    try {
      const { safeStorage } = await import('electron')
      if (!safeStorage.isAsyncEncryptionAvailable()) return false
      return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
    } catch { return false }
  },
  async encrypt(value) {
    const { safeStorage } = await import('electron')
    return safeStorage.encryptStringAsync(value)
  },
  async decrypt(value) {
    const { safeStorage } = await import('electron')
    return (await safeStorage.decryptStringAsync(value)).result
  }
}

export class PluginCredentialVault {
  constructor(
    private readonly dataRoot: string,
    private readonly encryption: CredentialEncryptionAdapter = electronEncryption
  ) {}

  async get(connectionId: string, kind: PluginCredentialKind): Promise<string | undefined> {
    validateKey(connectionId, kind)
    const encoded = (await readState(this.dataRoot)).secrets[connectionId]?.[kind]
    if (!encoded) return undefined
    if (!await this.encryption.available()) throw new Error('系统加密不可用，无法读取 MCP 凭据')
    try { return await this.encryption.decrypt(Buffer.from(encoded, 'base64')) }
    catch { throw new Error('MCP 凭据解密失败') }
  }

  async set(connectionId: string, kind: PluginCredentialKind, plaintext: string): Promise<void> {
    validateKey(connectionId, kind)
    const size = Buffer.byteLength(plaintext, 'utf8')
    if (!plaintext || size > MAX_PLAINTEXT_BYTES) throw new Error('MCP 凭据大小无效')
    if (!await this.encryption.available()) throw new Error('系统加密不可用，拒绝保存 MCP 凭据')
    const encrypted = await this.encryption.encrypt(plaintext)
    if (!encrypted.length || encrypted.length > MAX_CIPHERTEXT_BYTES) throw new Error('MCP 加密凭据大小无效')
    await mutate(this.dataRoot, (state) => {
      state.secrets[connectionId] = { ...state.secrets[connectionId], [kind]: encrypted.toString('base64') }
    })
  }

  async delete(connectionId: string, kind: PluginCredentialKind): Promise<void> {
    validateKey(connectionId, kind)
    await mutate(this.dataRoot, (state) => {
      if (!state.secrets[connectionId]) return
      delete state.secrets[connectionId][kind]
      if (!Object.keys(state.secrets[connectionId]).length) delete state.secrets[connectionId]
    })
  }

  async deleteConnection(connectionId: string): Promise<void> {
    if (!UUID.test(connectionId)) throw new Error('MCP 连接标识无效')
    await mutate(this.dataRoot, (state) => { delete state.secrets[connectionId] })
  }
}

export async function removePluginConnectionData(
  pluginId: string,
  disposition: PluginDataDisposition,
  dataRoot: string,
  store = new PluginConnectionStore(dataRoot),
  vault = new PluginCredentialVault(dataRoot)
): Promise<void> {
  if (!PLUGIN_ID.test(pluginId)) throw new Error('插件标识无效')
  if (disposition !== 'keep' && disposition !== 'clear') throw new Error('插件数据处理方式无效')
  const bindings = await store.listBindings()
  const ownedConnectionIds = new Set(bindings.filter((item) => item.pluginId === pluginId).map((item) => item.connectionId))
  const sharedConnectionIds = new Set(bindings.filter((item) => item.pluginId !== pluginId).map((item) => item.connectionId))
  await store.unbindPlugin(pluginId)
  if (disposition !== 'clear') return
  for (const connectionId of ownedConnectionIds) {
    if (sharedConnectionIds.has(connectionId)) continue
    await vault.deleteConnection(connectionId)
    await store.removeConnection(connectionId)
  }
}

function validateKey(connectionId: string, kind: PluginCredentialKind): void {
  if (!UUID.test(connectionId)) throw new Error('MCP 连接标识无效')
  if (!['api-key', 'access-token', 'refresh-token'].includes(kind)) throw new Error('MCP 凭据类型无效')
}

async function readState(dataRoot: string): Promise<PersistedCredentials> {
  try {
    const path = join(dataRoot, FILE)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) return empty()
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!record(value) || value.schemaVersion !== 1 || !record(value.secrets) || Object.keys(value.secrets).length > 100) return empty()
    const secrets: PersistedCredentials['secrets'] = {}
    for (const [connectionId, rawKinds] of Object.entries(value.secrets)) {
      if (!UUID.test(connectionId) || !record(rawKinds)) return empty()
      const entries = Object.entries(rawKinds)
      if (entries.length > 3) return empty()
      const parsed: Partial<Record<PluginCredentialKind, string>> = {}
      for (const [kind, encoded] of entries) {
        if (!isKind(kind) || typeof encoded !== 'string' || !isCanonicalBase64(encoded) ||
            Buffer.from(encoded, 'base64').length > MAX_CIPHERTEXT_BYTES) return empty()
        parsed[kind] = encoded
      }
      secrets[connectionId] = parsed
    }
    return { secrets }
  } catch { return empty() }
}

function mutate(dataRoot: string, action: (state: PersistedCredentials) => void): Promise<void> {
  const previous = queues.get(dataRoot) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(async () => {
    const state = await readState(dataRoot)
    action(state)
    await writeState(dataRoot, state)
  })
  queues.set(dataRoot, current)
  void current.finally(() => { if (queues.get(dataRoot) === current) queues.delete(dataRoot) }).catch(() => undefined)
  return current
}

async function writeState(dataRoot: string, state: PersistedCredentials): Promise<void> {
  await mkdir(dataRoot, { recursive: true })
  const path = join(dataRoot, FILE)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ schemaVersion: 1, ...state }), { flag: 'wx', mode: 0o600 })
  try { await rename(temporary, path) } finally { await rm(temporary, { force: true }).catch(() => undefined) }
}

function isCanonicalBase64(value: string): boolean {
  if (!value || value.length > Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  return Buffer.from(value, 'base64').toString('base64') === value
}
function isKind(value: string): value is PluginCredentialKind {
  return value === 'api-key' || value === 'access-token' || value === 'refresh-token'
}
function empty(): PersistedCredentials { return { secrets: {} } }
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
