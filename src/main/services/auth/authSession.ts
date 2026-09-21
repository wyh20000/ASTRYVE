import { app, dialog, safeStorage, shell } from 'electron'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuthStatus } from '@shared/types'
import { accountDataPath } from './accountPaths'
import { setBusinessIpcAvailable } from '../../ipc/validation'
import { cancelAllGenerations } from '../generationTasks'
import { cancelAllAgentTasks } from '../agent/taskRuntimeManager'
import { closeAllPluginUi } from '../agent/pluginUiWindow'
import { closeAllTerminals } from '../../ipc/terminal'

type AuthMode = 'local' | 'remote'
interface StoredSession { mode: 'remote'; token: string; userId: string; expiresAt: number }
interface LocalIdentity { mode: 'local'; userId: string }
type ActiveIdentity = StoredSession | LocalIdentity
interface PendingLogin {
  server: Server
  port: number
  state: string
  verifier: string
  requestId?: string
  timer?: ReturnType<typeof setTimeout>
  processing: boolean
}

const SECRET = /^[A-Za-z0-9_-]{43}$/
const FLOW_ID = /^[A-Za-z0-9_-]{32}$/
const LOCAL_PROFILE_ID = '00000000-0000-4000-8000-000000000001'
let baseUserData = ''
let serviceOrigin: string | undefined
let active: ActiveIdentity | undefined
let pending: PendingLogin | undefined
let status: AuthStatus = { mode: __AI_AGENT_AUTH_MODE__, state: 'signedOut' }
let recheckTimer: ReturnType<typeof setInterval> | undefined
let rechecking = false
let relaunching = false

function randomSecret(): string { return randomBytes(32).toString('base64url') }
function challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}
function equalSecret(left: string, right: string): boolean {
  if (!SECRET.test(left) || !SECRET.test(right)) return false
  return timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

export function validateAuthServiceOrigin(raw: string | undefined, packaged: boolean): string | undefined {
  if (!raw) return undefined
  const url = new URL(raw)
  const localDev = !packaged && url.protocol === 'http:' && url.hostname === '127.0.0.1'
  if ((url.protocol !== 'https:' && !localDev) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('认证服务地址无效：生产环境必须使用 HTTPS origin')
  }
  return url.origin
}

function credentialFile(): string { return join(baseUserData, 'auth-session.enc') }
function encryptedStorageReady(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false
  return true
}

async function readSession(): Promise<StoredSession | undefined> {
  if (!encryptedStorageReady()) return undefined
  try {
    const encrypted = await readFile(credentialFile())
    const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as Omit<StoredSession, 'mode'>
    const value: StoredSession = { ...parsed, mode: 'remote' }
    if (!SECRET.test(value.token) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now()) return undefined
    accountDataPath(baseUserData, value.userId)
    return value
  } catch { return undefined }
}

async function saveSession(value: StoredSession): Promise<void> {
  if (!encryptedStorageReady()) throw new Error('系统凭据保护不可用，无法保存登录状态')
  accountDataPath(baseUserData, value.userId)
  await mkdir(baseUserData, { recursive: true })
  const target = credentialFile()
  const temp = `${target}.${process.pid}.tmp`
  try {
    const { mode: _mode, ...persisted } = value
    await writeFile(temp, safeStorage.encryptString(JSON.stringify(persisted)), { mode: 0o600 })
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

async function clearSession(): Promise<void> { await rm(credentialFile(), { force: true }) }

class AuthHttpError extends Error {
  constructor(readonly statusCode: number) { super('认证服务请求失败') }
}

async function authJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  if (!serviceOrigin) throw new Error('认证服务尚未配置')
  const response = await fetch(`${serviceOrigin}${path}`, {
    ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json', ...init.headers }
  })
  if (!response.ok) throw new AuthHttpError(response.status)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > 16_384) throw new Error('认证服务响应过大')
  const body = await response.text()
  if (body.length > 16_384) throw new Error('认证服务响应过大')
  const parsed: unknown = JSON.parse(body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('认证服务响应无效')
  return parsed as Record<string, unknown>
}

async function verifySession(value: StoredSession): Promise<void> {
  const result = await authJson('/v1/auth/session', { headers: { authorization: `Bearer ${value.token}` } })
  const user = result.user as Record<string, unknown> | undefined
  if (user?.id !== value.userId) throw new Error('认证账号不匹配')
}

export async function initializeAuth(basePath: string, mode: AuthMode = __AI_AGENT_AUTH_MODE__): Promise<AuthStatus> {
  baseUserData = basePath
  setBusinessIpcAvailable(false)
  closePending()
  active = undefined
  serviceOrigin = undefined
  if (mode === 'local') {
    active = { mode: 'local', userId: LOCAL_PROFILE_ID }
    status = { mode, state: 'authenticated', userId: LOCAL_PROFILE_ID }
    return currentAuthStatus()
  }
  try { serviceOrigin = validateAuthServiceOrigin(process.env.AI_AGENT_AUTH_URL, app.isPackaged) }
  catch { status = { mode, state: 'unconfigured', message: '认证服务地址配置无效' }; return status }
  if (!serviceOrigin) { status = { mode, state: 'unconfigured', message: '尚未配置认证服务地址' }; return status }
  const stored = await readSession()
  if (!stored) { status = { mode, state: 'signedOut' }; return status }
  try {
    await verifySession(stored)
    active = stored
    status = { mode, state: 'authenticated', userId: stored.userId }
    return status
  } catch (error) {
    if (error instanceof AuthHttpError && error.statusCode === 401) {
      await clearSession().catch(() => undefined)
      status = { mode, state: 'signedOut', message: '登录已过期，请重新登录' }
    } else status = { mode, state: 'offline', message: '无法验证登录状态，请检查网络后重试' }
    return status
  }
}

export function currentAuthStatus(): AuthStatus { return { ...status } }
export function setDevelopmentSmokeAuth(): void {
  if (app.isPackaged || process.env.AI_AGENT_THEME_SMOKE !== '1') throw new Error('只允许开发主题测试使用')
  status = { mode: __AI_AGENT_AUTH_MODE__, state: 'authenticated',
    ...(__AI_AGENT_AUTH_MODE__ === 'local' ? { userId: LOCAL_PROFILE_ID } : {}) }
}
export function currentAccountPath(): string | undefined {
  if (!active) return undefined
  // Local mode has one device profile and historically stored data at the root.
  // Remote identities remain isolated in accounts/<userId>.
  return active.mode === 'local' ? baseUserData : accountDataPath(baseUserData, active.userId)
}

function closePending(): void {
  const login = pending
  pending = undefined
  if (!login) return
  if (login.timer) clearTimeout(login.timer)
  login.server.closeAllConnections()
  login.server.close()
}

export function cancelLogin(): AuthStatus {
  closePending()
  if (!active) status = { mode: 'remote', state: 'signedOut' }
  return currentAuthStatus()
}

function restartClient(): void {
  if (relaunching) return
  relaunching = true
  app.relaunch()
  app.quit()
}

function callbackPage(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" })
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ASTRYVE 登录</title><body>${text}</body></html>`)
}

async function handleCallback(req: IncomingMessage, res: ServerResponse, login: PendingLogin): Promise<void> {
  if (pending !== login || req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== `127.0.0.1:${login.port}` || req.method !== 'GET') {
    callbackPage(res, 400, '登录回调无效'); return
  }
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${login.port}`)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (url.pathname !== '/auth/callback' || url.searchParams.size !== 2 || !code || !state ||
      !SECRET.test(code) || !equalSecret(state, login.state) || !login.requestId || login.processing) {
    callbackPage(res, 400, '登录回调无效'); return
  }
  login.processing = true
  try {
    const redirectUri = `http://127.0.0.1:${login.port}/auth/callback`
    const result = await authJson('/v1/auth/desktop/exchange', { method: 'POST',
      body: JSON.stringify({ requestId: login.requestId, code, verifier: login.verifier, redirectUri }) })
    const token = result.token
    const user = result.user as Record<string, unknown> | undefined
    const expiresAt = result.expiresAt
    if (typeof token !== 'string' || !SECRET.test(token) || typeof user?.id !== 'string' ||
        typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('认证服务响应无效')
    }
    const value: StoredSession = { mode: 'remote', token, userId: user.id, expiresAt }
    if (pending !== login) throw new Error('登录请求已取消')
    await verifySession(value)
    if (pending !== login) throw new Error('登录请求已取消')
    await saveSession(value)
    callbackPage(res, 200, '登录成功，可以返回 ASTRYVE 客户端。')
    closePending()
    setTimeout(restartClient, 100)
  } catch {
    login.processing = false
    callbackPage(res, 400, '登录未完成，请返回客户端重试。')
    if (pending === login) status = { mode: 'remote', state: 'signedOut', message: '登录验证失败，请重试' }
  }
}

export async function startLogin(): Promise<AuthStatus> {
  if (status.mode === 'local') return currentAuthStatus()
  if (!serviceOrigin) return { mode: 'remote', state: 'unconfigured', message: '认证服务尚未配置' }
  if (active) return currentAuthStatus()
  closePending()
  const state = randomSecret()
  const verifier = randomSecret()
  const server = createServer((req, res) => {
    const login = pending
    if (!login || login.server !== server) { callbackPage(res, 410, '登录请求已失效'); return }
    void handleCallback(req, res, login).catch(() => {
      if (!res.headersSent) callbackPage(res, 500, '登录回调失败')
      else res.destroy()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('本地登录回调不可用') }
  const login: PendingLogin = { server, port: address.port, state, verifier, processing: false }
  pending = login
  try {
    const redirectUri = `http://127.0.0.1:${login.port}/auth/callback`
    const result = await authJson('/v1/auth/desktop/start', { method: 'POST',
      body: JSON.stringify({ redirectUri, state, codeChallenge: challenge(verifier) }) })
    if (pending !== login || typeof result.requestId !== 'string' || !FLOW_ID.test(result.requestId) ||
        typeof result.loginUrl !== 'string') throw new Error('登录请求响应无效')
    const loginUrl = new URL(result.loginUrl)
    if (loginUrl.origin !== serviceOrigin || loginUrl.pathname !== '/login' ||
        loginUrl.searchParams.get('requestId') !== result.requestId || loginUrl.searchParams.size !== 1) {
      throw new Error('登录地址不受信任')
    }
    login.requestId = result.requestId
    login.timer = setTimeout(() => {
      if (pending === login) { closePending(); status = { mode: 'remote', state: 'signedOut', message: '登录超时，请重试' } }
    }, 10 * 60_000)
    await shell.openExternal(loginUrl.toString())
    if (pending !== login) return currentAuthStatus()
    status = { mode: 'remote', state: 'waiting', message: '请在浏览器中完成登录' }
    return currentAuthStatus()
  } catch {
    if (pending === login) {
      closePending()
      status = { mode: 'remote', state: 'signedOut', message: '无法打开登录，请检查服务与浏览器' }
    }
    return currentAuthStatus()
  }
}

export async function logout(): Promise<{ revocationPending: boolean }> {
  if (active?.mode === 'local') throw new Error('本地模式不支持退出登录')
  closePending()
  setBusinessIpcAvailable(false)
  cancelAllGenerations('user_logout')
  cancelAllAgentTasks('user_logout')
  closeAllPluginUi()
  closeAllTerminals()
  if (recheckTimer) clearInterval(recheckTimer)
  const token = active?.token
  active = undefined
  status = { mode: 'remote', state: 'signedOut' }
  await clearSession()
  let revocationPending = false
  if (token) {
    try { await authJson('/v1/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }) }
    catch { revocationPending = true }
  }
  if (revocationPending) {
    await dialog.showMessageBox({ type: 'warning', buttons: ['知道了'],
      message: '已在本机退出登录，但暂时无法联系认证服务撤销远程会话。',
      detail: '该会话可能在服务端继续有效，直到过期。请检查网络并联系管理员处理。' })
  }
  setTimeout(restartClient, 250)
  return { revocationPending }
}

export async function startAccountLink(): Promise<{ opened: boolean }> {
  const session = active
  if (!session || session.mode !== 'remote' || status.state !== 'authenticated') throw new Error('请先登录')
  const result = await authJson('/v1/auth/link/start', {
    method: 'POST', headers: { authorization: `Bearer ${session.token}` }
  })
  if (active !== session || typeof result.requestId !== 'string' || !FLOW_ID.test(result.requestId) ||
      typeof result.linkUrl !== 'string') throw new Error('绑定请求响应无效')
  const linkUrl = new URL(result.linkUrl)
  if (linkUrl.origin !== serviceOrigin || linkUrl.pathname !== '/link' ||
      linkUrl.searchParams.size !== 1 || linkUrl.searchParams.get('requestId') !== result.requestId) {
    throw new Error('绑定地址不受信任')
  }
  await shell.openExternal(linkUrl.toString())
  return { opened: true }
}

export function startSessionRechecks(): void {
  if (recheckTimer) clearInterval(recheckTimer)
  if (!active || active.mode !== 'remote') return
  recheckTimer = setInterval(() => {
    if (!active || active.mode !== 'remote' || rechecking) return
    rechecking = true
    const value = active
    void verifySession(value).catch(async (error) => {
      if (active !== value) return
      active = undefined
      setBusinessIpcAvailable(false)
      cancelAllGenerations('auth_lost')
      cancelAllAgentTasks('auth_lost')
      closeAllPluginUi()
      closeAllTerminals()
      status = { mode: 'remote', state: 'offline', message: '登录状态无法验证，客户端已锁定' }
      if (error instanceof AuthHttpError && error.statusCode === 401) await clearSession().catch(() => undefined)
      restartClient()
    }).finally(() => { rechecking = false })
  }, 60_000)
}
