import { createHash, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createServer, type Server } from 'node:http'
import { isIP, type AddressInfo } from 'node:net'
import type { PluginCredentialKind } from './pluginCredentials'

const MAX_METADATA_BYTES = 64 * 1024
const MAX_TOKEN_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 15_000

export interface PkceRequest {
  verifier: string
  challenge: string
  challengeMethod: 'S256'
}

export interface OAuthMetadata {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
}

export function createPkceRequest(entropy = randomBytes(32)): PkceRequest {
  if (entropy.length < 32) throw new Error('PKCE 随机量不足')
  const verifier = entropy.toString('base64url')
  if (verifier.length < 43 || verifier.length > 128) throw new Error('PKCE verifier 长度无效')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    challengeMethod: 'S256'
  }
}

export async function discoverOAuth(
  fetcher: typeof fetch,
  resourceUrl: URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  resolveHostname: (hostname: string) => Promise<string[]> = resolveAddresses
): Promise<OAuthMetadata> {
  assertPublicHttps(resourceUrl, 'MCP resource')
  const resourceMetadataUrl = new URL('/.well-known/oauth-protected-resource', resourceUrl.origin)
  const resource = await fetchJson(fetcher, resourceMetadataUrl, timeoutMs, MAX_METADATA_BYTES, {}, resolveHostname)
  if (resource.resource !== resourceUrl.toString() || !Array.isArray(resource.authorization_servers) ||
      resource.authorization_servers.length !== 1 || typeof resource.authorization_servers[0] !== 'string') {
    throw new Error('OAuth resource 元数据无效')
  }
  const issuer = new URL(resource.authorization_servers[0])
  assertPublicHttps(issuer, 'OAuth issuer')
  const authorizationMetadataUrl = new URL('/.well-known/oauth-authorization-server', issuer.origin)
  const authorization = await fetchJson(fetcher, authorizationMetadataUrl, timeoutMs, MAX_METADATA_BYTES, {}, resolveHostname)
  if (authorization.issuer !== issuer.toString().replace(/\/$/, '')) throw new Error('OAuth issuer 不匹配')
  if (!Array.isArray(authorization.code_challenge_methods_supported) ||
      !authorization.code_challenge_methods_supported.includes('S256')) throw new Error('OAuth 服务不支持 PKCE S256')
  const authorizationEndpoint = exactHttpsUrl(authorization.authorization_endpoint, issuer.origin, 'authorization endpoint')
  const tokenEndpoint = exactHttpsUrl(authorization.token_endpoint, issuer.origin, 'token endpoint')
  const registrationEndpoint = authorization.registration_endpoint === undefined
    ? undefined
    : exactHttpsUrl(authorization.registration_endpoint, issuer.origin, 'registration endpoint')
  return { issuer: issuer.toString().replace(/\/$/, ''), authorizationEndpoint, tokenEndpoint, registrationEndpoint }
}

export class LoopbackOAuthReceiver {
  readonly redirectUri: string
  readonly result: Promise<{ code: string }>
  private settled = false
  private timer: NodeJS.Timeout

  private constructor(
    private readonly server: Server,
    private readonly expectedState: string,
    private readonly callbackPath: string,
    port: number,
    timeoutMs: number,
    settle: (handlers: { resolve: (value: { code: string }) => void; reject: (reason: Error) => void }) => void
  ) {
    this.redirectUri = `http://127.0.0.1:${port}${callbackPath}`
    let resolveResult!: (value: { code: string }) => void
    let rejectResult!: (reason: Error) => void
    this.result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    settle({ resolve: resolveResult, reject: rejectResult })
    this.timer = setTimeout(() => this.finish(undefined, new Error('OAuth 授权回调超时'), rejectResult), timeoutMs)
  }

  static async open(options: { state: string; timeoutMs?: number; callbackEntropy?: Buffer }): Promise<LoopbackOAuthReceiver> {
    if (!options.state || options.state.length > 256) throw new Error('OAuth state 无效')
    const callbackPath = `/oauth/callback/${(options.callbackEntropy ?? randomBytes(24)).toString('base64url')}`
    let receiver: LoopbackOAuthReceiver
    let resolveCallback!: (value: { code: string }) => void
    let rejectCallback!: (reason: Error) => void
    const server = createServer((request, response) => {
      const rejectRequest = (): void => {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        response.end('Invalid OAuth callback')
      }
      if (!receiver || receiver.settled || request.method !== 'GET' || !request.url || request.url.length > 2048) return rejectRequest()
      let url: URL
      try { url = new URL(request.url, receiver.redirectUri) } catch { return rejectRequest() }
      const codes = url.searchParams.getAll('code')
      const states = url.searchParams.getAll('state')
      if (url.pathname !== callbackPath || codes.length !== 1 || !codes[0] || states.length !== 1 || states[0] !== options.state) {
        return rejectRequest()
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end('<!doctype html><meta charset="utf-8"><title>Connected</title><p>Authorization complete. You may close this window.</p>')
      receiver.finish({ code: codes[0] }, undefined, rejectCallback, resolveCallback)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address() as AddressInfo
    receiver = new LoopbackOAuthReceiver(server, options.state, callbackPath, address.port, options.timeoutMs ?? 300_000,
      ({ resolve, reject }) => { resolveCallback = resolve; rejectCallback = reject })
    return receiver
  }

  close(reason = new Error('OAuth 授权已取消')): void {
    this.finish(undefined, reason, () => undefined)
  }

  private finish(
    value: { code: string } | undefined,
    error: Error | undefined,
    reject: (reason: Error) => void,
    resolve?: (value: { code: string }) => void
  ): void {
    if (this.settled) return
    this.settled = true
    clearTimeout(this.timer)
    this.server.close()
    if (value && resolve) resolve(value)
    else reject(error ?? new Error('OAuth 授权失败'))
  }
}

interface CredentialWriter {
  set(connectionId: string, kind: PluginCredentialKind, value: string): Promise<void>
}

export interface AuthorizeMcpConnectionOptions {
  connectionId: string
  resourceUrl: string
  clientId?: string
  scopes?: string[]
  fetch: typeof fetch
  openExternal(url: string): Promise<void>
  vault: CredentialWriter
  timeoutMs?: number
  now?: () => number
  resolveHostname?: (hostname: string) => Promise<string[]>
}

export async function authorizeMcpConnection(options: AuthorizeMcpConnectionOptions): Promise<{
  connected: true
  expiresAt?: number
}> {
  const resourceUrl = new URL(options.resourceUrl)
  const resolveHostname = options.resolveHostname ?? resolveAddresses
  const metadata = await discoverOAuth(options.fetch, resourceUrl, options.timeoutMs, resolveHostname)
  const pkce = createPkceRequest()
  const state = randomBytes(32).toString('base64url')
  const receiver = await LoopbackOAuthReceiver.open({ state, timeoutMs: options.timeoutMs ?? 300_000 })
  void receiver.result.catch(() => undefined)
  try {
    const clientId = options.clientId ?? await registerClient(options.fetch, metadata, receiver.redirectUri, options.timeoutMs, resolveHostname)
    const authorization = new URL(metadata.authorizationEndpoint)
    authorization.searchParams.set('response_type', 'code')
    authorization.searchParams.set('client_id', clientId)
    authorization.searchParams.set('redirect_uri', receiver.redirectUri)
    authorization.searchParams.set('resource', resourceUrl.toString())
    authorization.searchParams.set('state', state)
    authorization.searchParams.set('code_challenge', pkce.challenge)
    authorization.searchParams.set('code_challenge_method', pkce.challengeMethod)
    if (options.scopes?.length) authorization.searchParams.set('scope', options.scopes.join(' '))
    await options.openExternal(authorization.toString())
    const { code } = await receiver.result
    const token = await exchangeToken(options.fetch, metadata.tokenEndpoint, {
      code, clientId, redirectUri: receiver.redirectUri, verifier: pkce.verifier, resource: resourceUrl.toString()
    }, options.timeoutMs, resolveHostname)
    await options.vault.set(options.connectionId, 'access-token', token.accessToken)
    if (token.refreshToken) await options.vault.set(options.connectionId, 'refresh-token', token.refreshToken)
    const now = options.now?.() ?? Date.now()
    return { connected: true, ...(token.expiresIn === undefined ? {} : { expiresAt: now + token.expiresIn * 1000 }) }
  } finally {
    receiver.close()
  }
}

async function registerClient(
  fetcher: typeof fetch,
  metadata: OAuthMetadata,
  redirectUri: string,
  timeoutMs: number | undefined,
  resolveHostname: (hostname: string) => Promise<string[]>
): Promise<string> {
  if (!metadata.registrationEndpoint) throw new Error('OAuth 服务未提供动态客户端注册，插件必须声明 public client ID')
  const response = await fetchJson(fetcher, new URL(metadata.registrationEndpoint), timeoutMs ?? DEFAULT_TIMEOUT_MS,
    MAX_METADATA_BYTES, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], client_name: 'ASTRYVE Desktop' })
    }, resolveHostname)
  if (typeof response.client_id !== 'string' || !response.client_id || response.client_id.length > 512 || response.client_secret !== undefined) {
    throw new Error('OAuth 动态客户端注册响应无效')
  }
  return response.client_id
}

async function exchangeToken(
  fetcher: typeof fetch,
  endpoint: string,
  input: { code: string; clientId: string; redirectUri: string; verifier: string; resource: string },
  timeoutMs: number | undefined,
  resolveHostname: (hostname: string) => Promise<string[]>
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code: input.code, client_id: input.clientId,
    redirect_uri: input.redirectUri, code_verifier: input.verifier, resource: input.resource
  })
  const value = await fetchJson(fetcher, new URL(endpoint), timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TOKEN_BYTES, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body
  }, resolveHostname)
  if (typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 64 * 1024 ||
      value.token_type !== 'Bearer') throw new Error('OAuth token 响应无效')
  if (value.refresh_token !== undefined && (typeof value.refresh_token !== 'string' || !value.refresh_token || value.refresh_token.length > 64 * 1024)) {
    throw new Error('OAuth refresh token 响应无效')
  }
  if (value.expires_in !== undefined && (!Number.isSafeInteger(value.expires_in) || Number(value.expires_in) < 0)) {
    throw new Error('OAuth token 有效期无效')
  }
  return {
    accessToken: value.access_token,
    ...(value.refresh_token === undefined ? {} : { refreshToken: value.refresh_token }),
    ...(value.expires_in === undefined ? {} : { expiresIn: Number(value.expires_in) })
  }
}

async function fetchJson(
  fetcher: typeof fetch,
  url: URL,
  timeoutMs: number,
  maxBytes: number,
  init: RequestInit = {},
  resolveHostname: (hostname: string) => Promise<string[]> = resolveAddresses
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const addresses = await resolveHostname(url.hostname)
    if (!addresses.length || addresses.some(isPrivateOrReservedAddress)) throw new Error('OAuth 域名解析到本地、私有或保留地址')
    const response = await fetcher(url, { ...init, redirect: 'manual', signal: controller.signal })
    if (response.status >= 300 && response.status < 400) throw new Error('OAuth 不允许重定向')
    if (!response.ok) throw new Error(`OAuth HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error('OAuth 响应过大')
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('OAuth 响应过大')
    const value = JSON.parse(text) as unknown
    if (!record(value)) throw new Error('OAuth JSON 响应无效')
    return value
  } catch (error) {
    if (controller.signal.aborted) throw new Error('OAuth 请求超时')
    throw error
  } finally { clearTimeout(timer) }
}

function exactHttpsUrl(value: unknown, issuerOrigin: string, label: string): string {
  if (typeof value !== 'string') throw new Error(`OAuth ${label} 无效`)
  const url = new URL(value)
  assertPublicHttps(url, `OAuth ${label}`)
  if (url.origin !== issuerOrigin || url.username || url.password || url.hash) throw new Error(`OAuth ${label} 来源无效`)
  return url.toString()
}

function assertPublicHttps(url: URL, label: string): void {
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || isPrivateLiteral(url.hostname)) {
    throw new Error(`${label} 必须使用公网 HTTPS`)
  }
}

function isPrivateLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((item) => item.address)
}

function isPrivateOrReservedAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113)
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase()
    const first = Number.parseInt(lower.split(':')[0] || '0', 16)
    return first < 0x2000 || first > 0x3fff || lower.startsWith('2001:db8:')
  }
  return true
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
