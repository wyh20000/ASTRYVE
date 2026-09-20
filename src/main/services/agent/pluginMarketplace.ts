import { createHash, createPublicKey, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  PluginComponent, PluginMarketEntry, PluginMarketplaceSnapshot, PluginMarketSource, PluginMarketSourceInput, PluginPermission
} from '../../../shared/types'
import { compareSemver } from '../../../shared/semver'

const MAX_INDEX_BYTES = 1024 * 1024
const MAX_ENTRIES = 2_000
const MAX_INDEX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_INDEX_FUTURE_SKEW_MS = 5 * 60 * 1000
const MARKET_FILE = 'plugin-market.json'
export const CODEX_OFFICIAL_SOURCE_ID = 'source-00000000-0000-4000-8000-000000000001'
export const CODEX_OFFICIAL_INDEX_URL = 'https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json'
const CODEX_REPOSITORY = { owner: 'openai', repo: 'plugins' } as const
const OFFICIAL_PRESENTATION_VERSION = 2
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const PERMISSIONS = new Set<PluginPermission>([
  'workspace.read', 'workspace.write', 'network', 'process', 'browser.read', 'browser.interact'
])
const COMPONENTS = new Set<PluginComponent>(['skills', 'hooks', 'mcp', 'tools', 'ui'])
const CODEX_FEATURED_PLUGIN_IDS = new Set(['computer-use', 'spreadsheets', 'presentations'])

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

interface MarketplaceOptions { includeOfficial?: boolean }

export class PluginMarketplace {
  private initialization?: Promise<void>

  constructor(
    private readonly dataRoot: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly options: MarketplaceOptions = {}
  ) {}

  async snapshot(): Promise<PluginMarketplaceSnapshot> {
    await this.initializeOfficialSource()
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
    if (source.kind === 'official') throw new Error('官方市场源由应用管理，不能禁用')
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
      const entries = source.id === CODEX_OFFICIAL_SOURCE_ID
        ? await parseCodexMarketplaceIndex(parsed, source, this.fetcher)
        : parseMarketplaceIndex(parsed, source)
      state.entries = [...state.entries.filter((entry) => entry.sourceId !== id), ...entries]
      source.lastSyncAt = Date.now()
      if (source.id === CODEX_OFFICIAL_SOURCE_ID) source.presentationVersion = OFFICIAL_PRESENTATION_VERSION
      delete source.error
    } catch (error) {
      source.error = safeError(error)
    }
    await this.save(state)
    return clone(state)
  }

  private async load(): Promise<PluginMarketplaceSnapshot> {
    let state: PluginMarketplaceSnapshot
    try {
      const parsed = JSON.parse(await readFile(join(this.dataRoot, MARKET_FILE), 'utf8')) as PluginMarketplaceSnapshot
      if (!Array.isArray(parsed.sources) || !Array.isArray(parsed.entries)) throw new Error('invalid cache')
      state = parsed
    } catch { state = { sources: [], entries: [] } }
    if (this.options.includeOfficial !== false) {
      const previous = state.sources.find((source) => source.id === CODEX_OFFICIAL_SOURCE_ID)
      const official = officialSource(previous)
      state.sources = [official, ...state.sources.filter((source) => source.id !== CODEX_OFFICIAL_SOURCE_ID)]
    }
    return state
  }

  private async initializeOfficialSource(): Promise<void> {
    if (this.options.includeOfficial === false) return
    if (!this.initialization) {
      this.initialization = (async () => {
        const state = await this.load()
        const official = state.sources.find((source) => source.id === CODEX_OFFICIAL_SOURCE_ID)
        if (official && (!official.lastSyncAt || official.presentationVersion !== OFFICIAL_PRESENTATION_VERSION)) {
          await this.syncSource(CODEX_OFFICIAL_SOURCE_ID)
        }
      })()
    }
    await this.initialization
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

function officialSource(previous?: PluginMarketSource): PluginMarketSource {
  return {
    id: CODEX_OFFICIAL_SOURCE_ID,
    name: 'Codex official',
    kind: 'official',
    url: CODEX_OFFICIAL_INDEX_URL,
    enabled: true,
    verified: true,
    lastSyncAt: previous?.lastSyncAt,
    error: previous?.error,
    presentationVersion: previous?.presentationVersion
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
    const components = raw.components === undefined ? undefined : strings(raw.components, '插件组件', 8, 30) as PluginComponent[]
    if (components?.some((component) => !COMPONENTS.has(component))) throw new Error('插件组件无效')
    const signature = optionalText(raw.signature, 4096)
    const signingKeyId = optionalText(raw.signingKeyId, 200)
    if (signingKeyId && !signature) throw new Error('市场插件签名标识缺少签名')
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
      publisherId: signature && source.signingPublicKey ? signingKeyFingerprint(source.signingPublicKey) : undefined,
      permissions: [...new Set(permissions)].sort(),
      categories: strings(raw.categories, '插件分类', 16, 40),
      recommended: source.kind === 'official' && optionalBoolean(raw.recommended) === true,
      capabilities: raw.capabilities === undefined ? undefined : strings(raw.capabilities, '插件能力', 32, 64),
      components: components ? [...new Set(components)].sort() : undefined,
      dataTargets: raw.dataTargets === undefined ? undefined : strings(raw.dataTargets, '数据目标', 32, 100),
      installable: supportsCurrentRuntime(components),
      unavailableReason: supportsCurrentRuntime(components) ? undefined : components?.length
        ? '插件包含当前不支持的组件'
        : '市场索引缺少组件声明，请联系来源维护者更新索引',
      changelog: optionalText(raw.changelog, 4000), minAppVersion: optionalText(raw.minAppVersion, 64),
      platforms: strings(raw.platforms, '支持平台', 10, 30),
      architectures: strings(raw.architectures, '支持架构', 10, 30)
    }
  }).sort((a, b) => a.name.localeCompare(b.name) || compareVersions(b.version, a.version))
}

/** Convert the public Codex repository marketplace into the application's normalized catalog. */
export async function parseCodexMarketplaceIndex(
  value: unknown,
  source: PluginMarketSource,
  fetcher: Fetcher = fetch
): Promise<PluginMarketEntry[]> {
  if (!record(value) || !Array.isArray(value.plugins) || value.plugins.length > MAX_ENTRIES) {
    throw new Error('Codex 官方市场索引格式无效')
  }
  /*
   * 取 main 分支当前提交 SHA，用于把清单与资源固定到不可变版本。
   *
   * 必须用 git/ref 端点而不是 commits/main：后者返回完整 commit 对象
   * （实测约 475KB，含文件级 diff 元数据），会超过下面的 256KB 上限，
   * 导致整个官方市场同步永久失败。git/ref 只返回 ref 对象（实测约 0.3KB），
   * 两者的 sha 完全一致。
   */
  const refResponse = await fetcher(
    `https://api.github.com/repos/${CODEX_REPOSITORY.owner}/${CODEX_REPOSITORY.repo}/git/ref/heads/main`,
    { headers: { Accept: 'application/vnd.github+json' }, redirect: 'error' }
  )
  if (!refResponse.ok) throw new Error(`读取 Codex 官方版本失败（HTTP ${refResponse.status}）`)
  const refBody = await readResponseText(refResponse, 256 * 1024, 'Codex 官方版本')
  const refPayload = JSON.parse(refBody) as unknown
  let ref: string | undefined
  if (record(refPayload) && record(refPayload.object)) {
    const sha = refPayload.object['sha']
    if (typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha)) ref = sha
  }
  if (!ref) throw new Error('Codex 官方版本标识无效')

  const seen = new Set<string>()
  const rawEntries = value.plugins.map((item) => {
    if (!record(item)) throw new Error('Codex 官方插件条目无效')
    const id = text(item.name, '插件标识', 64).toLowerCase()
    if (!ID_PATTERN.test(id) || seen.has(id)) throw new Error('Codex 官方插件标识重复或无效')
    seen.add(id)
    const category = optionalText(item.category, 80)
    const distribution = record(item.source) ? item.source : undefined
    const path = distribution?.source === 'local' && typeof distribution.path === 'string'
      ? normalizeCodexPluginPath(distribution.path, id)
      : undefined
    return { id, category, path }
  })

  const entries = await mapLimited(rawEntries, 8, async ({ id, category, path }): Promise<PluginMarketEntry> => {
    const base: PluginMarketEntry = {
      id, name: id, version: '0.0.0', description: 'Codex 官方插件', author: 'OpenAI',
      sourceId: source.id, sourceName: source.name, sourceKind: 'official', verified: true,
      permissions: [], categories: category ? [category] : [], platforms: [], architectures: [],
      recommended: CODEX_FEATURED_PLUGIN_IDS.has(id),
      publisherId: `github:${CODEX_REPOSITORY.owner}/${CODEX_REPOSITORY.repo}`,
      installable: false, unavailableReason: '当前来源类型暂不支持直接安装'
    }
    if (!path) return base
    try {
      const manifestUrl = `https://raw.githubusercontent.com/${CODEX_REPOSITORY.owner}/${CODEX_REPOSITORY.repo}/${ref}/${path}/.codex-plugin/plugin.json`
      const response = await fetcher(manifestUrl, { redirect: 'error' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const manifest = JSON.parse(await readResponseText(response, 256 * 1024, '插件清单')) as unknown
      if (!record(manifest) || String(manifest.name).toLowerCase() !== id) throw new Error('插件清单身份不一致')
      const interfaceValue = record(manifest.interface) ? manifest.interface : undefined
      const components: PluginComponent[] = []
      if (typeof manifest.skills === 'string') components.push('skills')
      if (record(manifest.hooks) && Object.keys(manifest.hooks).length) components.push('hooks')
      if (manifest.mcp !== undefined || manifest.mcpServers !== undefined) components.push('mcp')
      if (Array.isArray(manifest.tools) && manifest.tools.length) components.push('tools')
      if (typeof manifest.ui === 'string') components.push('ui')
      const permissions = strings(manifest.permissions, '插件权限', 32, 64) as PluginPermission[]
      if (permissions.some((permission) => !PERMISSIONS.has(permission))) throw new Error('插件权限无效')
      const hasUnsupportedApps = manifest.apps !== undefined
      const installable = !hasUnsupportedApps && supportsCurrentRuntime(components)
      const author = typeof manifest.author === 'string'
        ? manifest.author
        : record(manifest.author) && typeof manifest.author.name === 'string' ? manifest.author.name : 'OpenAI'
      return {
        ...base,
        name: typeof interfaceValue?.displayName === 'string' ? interfaceValue.displayName.slice(0, 100) : id,
        version: typeof manifest.version === 'string' && VERSION_PATTERN.test(manifest.version) ? manifest.version : '0.0.0',
        description: typeof manifest.description === 'string' ? manifest.description.slice(0, 1000) : base.description,
        author: author.slice(0, 100),
        permissions: [...new Set(permissions)].sort(),
        capabilities: strings(interfaceValue?.capabilities, '插件能力', 32, 64),
        dataTargets: strings(interfaceValue?.dataTargets, '数据目标', 32, 100),
        brandColor: officialBrandColor(interfaceValue?.brandColor),
        composerIconUrl: officialAssetUrl(ref, path, interfaceValue?.composerIcon),
        logoUrl: officialAssetUrl(ref, path, interfaceValue?.logo),
        logoDarkUrl: officialAssetUrl(ref, path, interfaceValue?.logoDark),
        components,
        installable,
        unavailableReason: installable ? undefined : hasUnsupportedApps
          ? '此插件包含尚未接入的应用连接'
          : '此插件需要尚未接入的 MCP 或应用连接',
        repository: { ...CODEX_REPOSITORY, ref, path }
      }
    } catch (error) {
      return { ...base, unavailableReason: `暂时无法读取插件清单：${safeError(error)}` }
    }
  })
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

export function compareVersions(left: string, right: string): number {
  return compareSemver(left, right)
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
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error('字段无效')
  return value
}
function signingKeyFingerprint(publicKey: string): string {
  const der = createPublicKey(publicKey).export({ type: 'spki', format: 'der' })
  return `ed25519:${createHash('sha256').update(der).digest('hex')}`
}
function supportsCurrentRuntime(components: readonly PluginComponent[] | undefined): boolean {
  return Boolean(components?.length && components.every((component) =>
    component === 'skills' || component === 'tools' || component === 'mcp' || component === 'hooks' || component === 'ui'))
}
function normalizeCodexPluginPath(value: string, id: string): string | undefined {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  return normalized === `plugins/${id}` ? normalized : undefined
}
function officialBrandColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined
}
function officialAssetUrl(ref: string, pluginPath: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('./') || value.includes('\\')) return undefined
  const segments = value.slice(2).split('/')
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) return undefined
  if (!/\.(?:png|svg|webp)$/i.test(segments.at(-1) ?? '')) return undefined
  const encodedPath = [...pluginPath.split('/'), ...segments].map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${CODEX_REPOSITORY.owner}/${CODEX_REPOSITORY.repo}/${ref}/${encodedPath}`
}
async function readResponseText(response: Response, maxBytes: number, label: string): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > maxBytes) throw new Error(`${label}超过大小限制`)
  const body = await response.text()
  if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error(`${label}超过大小限制`)
  return body
}
async function mapLimited<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index])
    }
  }))
  return results
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
