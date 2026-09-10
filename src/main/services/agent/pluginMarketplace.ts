import { createPublicKey, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  PluginMarketEntry, PluginMarketplaceSnapshot, PluginMarketSource, PluginMarketSourceInput, PluginPermission
} from '../../../shared/types'

const MAX_INDEX_BYTES = 1024 * 1024
const MAX_ENTRIES = 2_000
const MAX_INDEX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_INDEX_FUTURE_SKEW_MS = 5 * 60 * 1000
const MARKET_FILE = 'plugin-market.json'
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const PERMISSIONS = new Set<PluginPermission>([
  'workspace.read', 'workspace.write', 'network', 'process', 'browser.read', 'browser.interact'
])

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export class PluginMarketplace {
  constructor(private readonly dataRoot: string, private readonly fetcher: Fetcher = fetch) {}

  async snapshot(): Promise<PluginMarketplaceSnapshot> {
    return clone(await this.load())
  }

  async addSource(input: PluginMarketSourceInput): Promise<PluginMarketSource> {
    const url = requireHttps(input.url, '市场源')
    const name = text(input.name, '市场源名称', 80)
    const state = await this.load()
    if (state.sources.some((source) => source.url.toLowerCase() === url.toLowerCase())) throw new Error('市场源已存在')
    const source: PluginMarketSource = {
      id: `source-${randomUUID()}`, name, kind: inferSourceKind(url), url, enabled: true, verified: false,
      ...validateSigningKey(input.signingKeyId, input.signingPublicKey)
    }
    state.sources.push(source)
    await this.save(state)
    return { ...source }
  }

  async setSourceEnabled(id: string, enabled: boolean): Promise<PluginMarketplaceSnapshot> {
    const state = await this.load()
    const source = state.sources.find((item) => item.id === id)
    if (!source) throw new Error('市场源不存在')
    source.enabled = enabled
    if (!enabled) state.entries = state.entries.filter((entry) => entry.sourceId !== id)
    await this.save(state)
    return clone(state)
  }

  async removeSource(id: string): Promise<PluginMarketplaceSnapshot> {
    const state = await this.load()
    const source = state.sources.find((item) => item.id === id)
    if (!source) throw new Error('市场源不存在')
    if (source.kind === 'official') throw new Error('官方市场源不能删除')
    state.sources = state.sources.filter((item) => item.id !== id)
    state.entries = state.entries.filter((entry) => entry.sourceId !== id)
    await this.save(state)
    return clone(state)
  }

  async syncSource(id: string): Promise<PluginMarketplaceSnapshot> {
    const state = await this.load()
    const source = state.sources.find((item) => item.id === id)
    if (!source) throw new Error('市场源不存在')
    if (!source.enabled) throw new Error('市场源已禁用')
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      let response: Response
      try { response = await this.fetcher(source.url, { signal: controller.signal, redirect: 'error' }) }
      finally { clearTimeout(timer) }
      if (!response.ok) throw new Error(`同步失败（HTTP ${response.status}）`)
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length > MAX_INDEX_BYTES) throw new Error('市场索引超过大小限制')
      const body = await response.text()
      if (Buffer.byteLength(body, 'utf8') > MAX_INDEX_BYTES) throw new Error('市场索引超过大小限制')
      const parsed = JSON.parse(body) as unknown
      const entries = parseMarketplaceIndex(parsed, source)
      state.entries = [...state.entries.filter((entry) => entry.sourceId !== id), ...entries]
      source.lastSyncAt = Date.now()
      delete source.error
    } catch (error) {
      source.error = safeError(error)
    }
    await this.save(state)
    return clone(state)
  }

  private async load(): Promise<PluginMarketplaceSnapshot> {
    try {
      const parsed = JSON.parse(await readFile(join(this.dataRoot, MARKET_FILE), 'utf8')) as PluginMarketplaceSnapshot
      if (!Array.isArray(parsed.sources) || !Array.isArray(parsed.entries)) throw new Error('invalid cache')
      return parsed
    } catch { return { sources: [], entries: [] } }
  }

  private async save(state: PluginMarketplaceSnapshot): Promise<void> {
    await mkdir(this.dataRoot, { recursive: true })
    const target = join(this.dataRoot, MARKET_FILE)
    const temp = `${target}.${process.pid}.tmp`
    try {
      await writeFile(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
      await rename(temp, target)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }
}

export function parseMarketplaceIndex(value: unknown, source: PluginMarketSource, now = Date.now()): PluginMarketEntry[] {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.plugins) || value.plugins.length > MAX_ENTRIES) {
    throw new Error('市场索引格式无效')
  }
  const generatedAt = typeof value.generatedAt === 'string' ? Date.parse(value.generatedAt) : Number.NaN
  if (!Number.isFinite(generatedAt)) throw new Error('市场索引生成时间无效')
  if (generatedAt > now + MAX_INDEX_FUTURE_SKEW_MS) throw new Error('市场索引生成时间来自未来')
  if (generatedAt < now - MAX_INDEX_AGE_MS) throw new Error('市场索引已过期')
  const seen = new Set<string>()
  return value.plugins.map((raw) => {
    if (!record(raw)) throw new Error('市场插件条目无效')
    const id = text(raw.id, '插件标识', 64).toLowerCase()
    const version = text(raw.version, '插件版本', 64)
    if (!ID_PATTERN.test(id) || !VERSION_PATTERN.test(version)) throw new Error('插件标识或版本无效')
    const release = `${id}@${version}`
    if (seen.has(release)) throw new Error('市场索引包含重复插件版本')
    seen.add(release)
    const sha256 = text(raw.sha256, '插件摘要', 64).toLowerCase()
    if (!SHA256_PATTERN.test(sha256)) throw new Error('插件摘要无效')
    const permissions = strings(raw.permissions, '插件权限', 32, 64) as PluginPermission[]
    if (permissions.some((permission) => !PERMISSIONS.has(permission))) throw new Error('插件权限无效')
    const signature = optionalText(raw.signature, 4096)
    const signingKeyId = optionalText(raw.signingKeyId, 200)
    if (signature && (!signingKeyId || !source.signingPublicKey || source.signingKeyId !== signingKeyId)) {
      throw new Error('市场插件签名没有匹配的来源公钥')
    }
    return {
      id, version, sha256,
      name: text(raw.name, '插件名称', 100),
      description: text(raw.description, '插件说明', 1000),
      author: text(raw.author, '插件作者', 100),
      sourceId: source.id, sourceName: source.name, sourceKind: source.kind,
      verified: source.kind === 'official' && source.verified === true,
      packageUrl: requireHttps(raw.packageUrl, '插件下载地址'),
      signature, signingKeyId, signingPublicKey: signature ? source.signingPublicKey : undefined,
      permissions: [...new Set(permissions)].sort(),
      categories: strings(raw.categories, '插件分类', 16, 40),
      changelog: optionalText(raw.changelog, 4000), minAppVersion: optionalText(raw.minAppVersion, 64),
      platforms: strings(raw.platforms, '支持平台', 10, 30),
      architectures: strings(raw.architectures, '支持架构', 10, 30)
    }
  }).sort((a, b) => a.name.localeCompare(b.name) || compareVersions(b.version, a.version))
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(/[.-]/).slice(0, 3).map(Number)
  const b = right.split(/[.-]/).slice(0, 3).map(Number)
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index]
  return left.localeCompare(right)
}

function inferSourceKind(url: string): 'github' | 'community' {
  return new URL(url).hostname.toLowerCase() === 'github.com' || new URL(url).hostname.toLowerCase().endsWith('.githubusercontent.com')
    ? 'github' : 'community'
}
function requireHttps(value: unknown, label: string): string {
  const url = text(value, label, 2048)
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error(`${label}无效`) }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`${label}必须使用 HTTPS`)
  return parsed.toString()
}
function strings(value: unknown, label: string, max: number, length: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}无效`)
  return value.map((item) => text(item, label, length))
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label}无效`)
  const result = value.trim()
  if (!result || result.length > max || /[\u0000-\u001f]/.test(result)) throw new Error(`${label}无效`)
  return result
}
function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined
  return text(value, '字段', max)
}
function validateSigningKey(keyId: unknown, publicKey: unknown): Pick<PluginMarketSource, 'signingKeyId' | 'signingPublicKey'> {
  if (keyId === undefined && publicKey === undefined) return {}
  const id = text(keyId, '签名密钥标识', 200)
  if (typeof publicKey !== 'string' || !publicKey.trim() || publicKey.length > 8192 || /[\u0000-\u0009\u000b\u000c\u000e-\u001f]/.test(publicKey)) {
    throw new Error('签名公钥无效')
  }
  const pem = publicKey
  try {
    const key = createPublicKey(pem)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error()
  } catch { throw new Error('签名公钥必须是有效的 Ed25519 公钥') }
  return { signingKeyId: id, signingPublicKey: pem }
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : '市场同步失败').slice(0, 300) }
function clone<T>(value: T): T { return structuredClone(value) }
