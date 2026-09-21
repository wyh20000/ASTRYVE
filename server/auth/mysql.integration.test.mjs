import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'

test('real MySQL atomically exchanges desktop codes and revokes sessions', {
  skip: !process.env.AUTH_TEST_MYSQL_URL
}, async () => {
  const adminUrl = new URL(process.env.AUTH_TEST_MYSQL_URL)
  const database = `aiagent_auth_it_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  const admin = await mysql.createConnection(adminUrl.toString())
  let pool
  let server
  try {
    await admin.query(`CREATE DATABASE \`${database}\``)
    const testUrl = new URL(adminUrl)
    testUrl.pathname = `/${database}`
    pool = mysql.createPool({ uri: testUrl.toString(), connectionLimit: 4, multipleStatements: false })
    const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
    for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
      await pool.query(statement)
    }

    process.env.AUTH_PUBLIC_URL = 'http://127.0.0.1:8787'
    process.env.AUTH_INSECURE_LOCAL_DEV = '1'
    process.env.AUTH_CODE_SECRET = randomBytes(48).toString('base64url')
    const [{ createAuthRequestHandler }, { codeChallenge, randomSecret }] = await Promise.all([
      import('./index.mjs'), import('./desktopProtocol.mjs')
    ])
    let sentCode
    const smsGateway = { configured: true, send: async (_phone, code) => { sentCode = code } }
    server = createServer(createAuthRequestHandler(pool, smsGateway))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = (path, body, headers = {}) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    })
    const redirectUri = 'http://127.0.0.1:32123/auth/callback'
    const verifier = randomSecret()
    const state = randomSecret()
    const start = await request('/v1/auth/desktop/start', {
      redirectUri, state, codeChallenge: codeChallenge(verifier)
    })
    assert.equal(start.status, 200)
    const { requestId } = await start.json()
    const login = await fetch(`${base}/login?requestId=${requestId}`)
    assert.equal(login.status, 200)
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/)
    const csrf = (await login.text()).match(/data-csrf="([A-Za-z0-9_-]{43})"/)?.[1]
    assert.ok(csrf)
    const webHeaders = {
      origin: 'http://127.0.0.1:8787',
      cookie: login.headers.get('set-cookie').split(';')[0],
      'x-csrf-token': csrf
    }
    const phone = '+8613800138000'
    assert.equal((await request('/v1/auth/sms/request', { requestId, phone }, webHeaders)).status, 202)
    assert.match(sentCode, /^\d{6}$/)
    const wrongCode = `${(Number(sentCode[0]) + 1) % 10}${sentCode.slice(1)}`
    assert.equal((await request('/v1/auth/sms/verify', { requestId, phone, code: wrongCode }, webHeaders)).status, 401)
    const verified = await request('/v1/auth/sms/verify', { requestId, phone, code: sentCode }, webHeaders)
    assert.equal(verified.status, 200)
    const { redirectUrl } = await verified.json()
    const callback = new URL(redirectUrl)
    assert.equal(callback.origin, 'http://127.0.0.1:32123')
    assert.equal(callback.searchParams.get('state'), state)
    const code = callback.searchParams.get('code')
    assert.match(code, /^[A-Za-z0-9_-]{43}$/)
    assert.equal((await request('/v1/auth/sms/verify', { requestId, phone, code: sentCode }, webHeaders)).status, 403)

    const exchange = (candidateVerifier) => request('/v1/auth/desktop/exchange', {
      requestId, code, verifier: candidateVerifier, redirectUri
    })
    assert.equal((await exchange(randomSecret())).status, 401)
    const results = await Promise.all([exchange(verifier), exchange(verifier)])
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 401])
    const success = results.find((result) => result.status === 200)
    const { token, user } = await success.json()
    assert.match(user.id, /^[0-9a-f-]{36}$/)
    assert.equal((await exchange(verifier)).status, 401)

    const authHeaders = { authorization: `Bearer ${token}` }
    const session = await fetch(`${base}/v1/auth/session`, { headers: authHeaders })
    assert.equal(session.status, 200)
    assert.deepEqual(await session.json(), { user: { id: user.id } })
    assert.equal((await request('/v1/auth/logout', {}, authHeaders)).status, 200)
    assert.equal((await fetch(`${base}/v1/auth/session`, { headers: authHeaders })).status, 401)
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    if (pool) await pool.end()
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await admin.end()
  }
})
