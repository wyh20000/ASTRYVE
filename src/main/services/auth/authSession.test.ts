import { createServer, type IncomingMessage } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
  relaunch: vi.fn(),
  quit: vi.fn(),
  showMessageBox: vi.fn(async () => ({ response: 0 }))
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, relaunch: mocks.relaunch, quit: mocks.quit },
  shell: { openExternal: mocks.openExternal },
  dialog: { showMessageBox: mocks.showMessageBox },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (value: string) => Buffer.from('sealed:' + Buffer.from(value).toString('base64')),
    decryptString: (value: Buffer) => {
      const text = value.toString()
      if (!text.startsWith('sealed:')) throw new Error('invalid ciphertext')
      return Buffer.from(text.slice(7), 'base64').toString()
    }
  }
}))
vi.mock('../generationTasks', () => ({ cancelAllGenerations: vi.fn() }))
vi.mock('../agent/taskRuntimeManager', () => ({ cancelAllAgentTasks: vi.fn() }))
vi.mock('../agent/pluginUiWindow', () => ({ closeAllPluginUi: vi.fn() }))
vi.mock('../../ipc/terminal', () => ({ closeAllTerminals: vi.fn() }))

import { cancelLogin, currentAuthStatus, initializeAuth, logout, startAccountLink, startLogin } from './authSession'
import { isBusinessIpcAvailable, setBusinessIpcAvailable } from '../../ipc/validation'

async function readJson(req: IncomingMessage): Promise<Record<string, string>> {
  const parts: Buffer[] = []
  for await (const part of req) parts.push(part)
  return JSON.parse(Buffer.concat(parts).toString()) as Record<string, string>
}

describe('desktop authentication round trip', () => {
  let root: string
  let service: ReturnType<typeof createServer>
  let origin: string
  let flow: Record<string, string>
  let exchanges = 0
  let revoked = false
  let offline = false
  const requestId = 'R'.repeat(32)
  const code = randomBytes(32).toString('base64url')
  const token = randomBytes(32).toString('base64url')
  const userId = randomUUID()

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'aiagent-auth-client-test-'))
    service = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', origin)
        const reply = (status: number, body: object) => {
          res.writeHead(status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        if (url.pathname === '/v1/auth/desktop/start') {
          flow = await readJson(req)
          reply(200, { requestId, loginUrl: `${origin}/login?requestId=${requestId}` })
        } else if (url.pathname === '/v1/auth/desktop/exchange') {
          const body = await readJson(req)
          exchanges++
          const actualChallenge = createHash('sha256').update(body.verifier, 'ascii').digest('base64url')
          if (body.requestId !== requestId || body.code !== code ||
              body.redirectUri !== flow.redirectUri || actualChallenge !== flow.codeChallenge) {
            reply(401, { error: 'invalid code' })
          } else reply(200, { token, user: { id: userId }, expiresAt: Date.now() + 60_000 })
        } else if (url.pathname === '/v1/auth/session') {
          if (offline) reply(503, { error: 'unavailable' })
          else if (req.headers.authorization !== `Bearer ${token}` || revoked) reply(401, { error: 'expired' })
          else reply(200, { user: { id: userId } })
        } else if (url.pathname === '/v1/auth/logout') {
          if (req.headers.authorization !== `Bearer ${token}`) reply(401, { error: 'expired' })
          else { revoked = true; reply(200, { ok: true }) }
        } else if (url.pathname === '/v1/auth/link/start') {
          if (req.headers.authorization !== `Bearer ${token}` || revoked) reply(401, { error: 'expired' })
          else reply(200, { requestId, linkUrl: `${origin}/link?requestId=${requestId}` })
        } else reply(404, { error: 'missing' })
      })().catch(() => { res.writeHead(500); res.end() })
    })
    await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(service.address() as { port: number }).port}`
    process.env.AI_AGENT_AUTH_URL = origin
  })

  afterAll(async () => {
    delete process.env.AI_AGENT_AUTH_URL
    service.closeAllConnections()
    await new Promise<void>((resolve) => service.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  })

  it('rejects forged callbacks, saves a verified session and locks on logout', async () => {
    expect((await initializeAuth(root)).state).toBe('signedOut')
    expect(isBusinessIpcAvailable()).toBe(false)
    expect((await startLogin()).state).toBe('waiting')
    expect(mocks.openExternal).toHaveBeenCalledWith(`${origin}/login?requestId=${requestId}`)

    const callback = new URL(flow.redirectUri)
    callback.searchParams.set('code', code)
    callback.searchParams.set('state', randomBytes(32).toString('base64url'))
    expect((await fetch(callback)).status).toBe(400)
    expect(exchanges).toBe(0)
    callback.searchParams.set('state', flow.state)
    callback.pathname = '/wrong'
    expect((await fetch(callback)).status).toBe(400)
    expect(exchanges).toBe(0)

    callback.pathname = '/auth/callback'
    expect((await fetch(callback)).status).toBe(200)
    expect(exchanges).toBe(1)
    const encrypted = await readFile(join(root, 'auth-session.enc'))
    expect(encrypted.toString()).not.toContain(token)
    expect((await initializeAuth(root)).state).toBe('authenticated')
    expect(currentAuthStatus().userId).toBe(userId)
    expect((await startAccountLink()).opened).toBe(true)
    expect(mocks.openExternal).toHaveBeenCalledWith(`${origin}/link?requestId=${requestId}`)

    setBusinessIpcAvailable(true)
    expect((await logout()).revocationPending).toBe(false)
    expect(isBusinessIpcAvailable()).toBe(false)
    expect(revoked).toBe(true)
    await expect(stat(join(root, 'auth-session.enc'))).rejects.toThrow()
    expect((await initializeAuth(root)).state).toBe('signedOut')
    await expect(startAccountLink()).rejects.toThrow('请先登录')
    cancelLogin()
  })

  it('uses an isolated local identity without contacting or persisting a remote session', async () => {
    const localRoot = await mkdtemp(join(tmpdir(), 'aiagent-local-profile-test-'))
    try {
      const local = await initializeAuth(localRoot, 'local')
      expect(local).toEqual({
        mode: 'local', state: 'authenticated', userId: '00000000-0000-4000-8000-000000000001'
      })
      expect(currentAuthStatus()).toEqual(local)
      expect(await startLogin()).toEqual(local)
      await expect(logout()).rejects.toThrow('本地模式不支持退出登录')
      await expect(startAccountLink()).rejects.toThrow('请先登录')
      await expect(stat(join(localRoot, 'auth-session.enc'))).rejects.toThrow()
    } finally {
      await rm(localRoot, { recursive: true, force: true })
      await initializeAuth(root, 'remote')
    }
  })

  it('rejects revoked startup sessions and keeps offline sessions locked', async () => {
    const file = join(root, 'auth-session.enc')
    const stored = { token, userId, expiresAt: Date.now() + 60_000 }
    const persist = () => writeFile(file,
      Buffer.from('sealed:' + Buffer.from(JSON.stringify(stored)).toString('base64')))
    await persist()
    expect((await initializeAuth(root)).state).toBe('signedOut')
    expect(isBusinessIpcAvailable()).toBe(false)
    await expect(stat(file)).rejects.toThrow()

    revoked = false
    offline = true
    await persist()
    expect((await initializeAuth(root)).state).toBe('offline')
    expect(isBusinessIpcAvailable()).toBe(false)
    expect((await stat(file)).isFile()).toBe(true)
    offline = false
  })
})
