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
    process.env.QQ_CLIENT_ID = 'test-qq-client'
    process.env.QQ_CLIENT_SECRET = 'test-qq-secret'
    process.env.WECHAT_CLIENT_ID = 'test-wechat-client'
    process.env.WECHAT_CLIENT_SECRET = 'test-wechat-secret'
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

    const beginLink = async () => {
      const start = await request('/v1/auth/link/start', {}, authHeaders)
      assert.equal(start.status, 200)
      const { requestId: linkId, linkUrl } = await start.json()
      assert.equal(new URL(linkUrl).pathname, '/link')
      const page = await fetch(`${base}/link?requestId=${linkId}`)
      assert.equal(page.status, 200)
      const html = await page.text()
      assert.match(html, /data-purpose="link"/)
      const linkCsrf = html.match(/data-csrf="([A-Za-z0-9_-]{43})"/)?.[1]
      assert.ok(linkCsrf)
      return { requestId: linkId, headers: {
        origin: 'http://127.0.0.1:8787',
        cookie: page.headers.get('set-cookie').split(';')[0],
        'x-csrf-token': linkCsrf
      } }
    }
    assert.equal((await request('/v1/auth/link/start', {})).status, 401)
    const phoneLink = await beginLink()
    const secondPhone = '+8613800138001'
    assert.equal((await request('/v1/auth/link/sms/request',
      { requestId: phoneLink.requestId, phone: secondPhone })).status, 403)
    assert.equal((await request('/v1/auth/link/sms/request',
      { requestId: phoneLink.requestId, phone: secondPhone }, phoneLink.headers)).status, 202)
    assert.equal((await request('/v1/auth/link/sms/verify',
      { requestId: phoneLink.requestId, phone: secondPhone, code: sentCode }, phoneLink.headers)).status, 200)
    const [linkedPhone] = await pool.execute(
      'SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?', ['phone', secondPhone]
    )
    assert.equal(linkedPhone[0].user_id, user.id)
    assert.equal((await request('/v1/auth/link/sms/verify',
      { requestId: phoneLink.requestId, phone: secondPhone, code: sentCode }, phoneLink.headers)).status, 403)

    const otherUser = randomUUID()
    const takenPhone = '+8613800138002'
    await pool.execute('INSERT INTO auth_users (id, created_at) VALUES (?, ?)', [otherUser, Date.now()])
    await pool.execute('INSERT INTO auth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)',
      ['phone', takenPhone, otherUser, Date.now()])
    const conflictLink = await beginLink()
    assert.equal((await request('/v1/auth/link/sms/request',
      { requestId: conflictLink.requestId, phone: takenPhone }, conflictLink.headers)).status, 202)
    assert.equal((await request('/v1/auth/link/sms/verify',
      { requestId: conflictLink.requestId, phone: takenPhone, code: sentCode }, conflictLink.headers)).status, 409)
    const [takenIdentity] = await pool.execute(
      'SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?', ['phone', takenPhone]
    )
    assert.equal(takenIdentity[0].user_id, otherUser)

    const originalFetch = globalThis.fetch
    let qqSubject = 'qq-openid-12345'
    globalThis.fetch = (input, init) => {
      const url = new URL(input)
      if (url.origin === 'https://graph.qq.com') {
        if (url.pathname === '/oauth2.0/token') return Promise.resolve(new Response(
          JSON.stringify({ access_token: 'qq-access-token-123' }), { status: 200 }))
        if (url.pathname === '/oauth2.0/me') return Promise.resolve(new Response(
          JSON.stringify({ client_id: 'test-qq-client', openid: qqSubject }), { status: 200 }))
      }
      if (url.origin === 'https://api.weixin.qq.com') {
        if (url.pathname === '/sns/oauth2/access_token') return Promise.resolve(new Response(
          JSON.stringify({ access_token: 'wechat-access-token-123', openid: 'wechat-openid-123' }),
          { status: 200 }))
        if (url.pathname === '/sns/auth') return Promise.resolve(new Response(
          JSON.stringify({ errcode: 0 }), { status: 200 }))
      }
      if (url.origin === base) return originalFetch(input, init)
      throw new Error(`Unexpected outbound request: ${url.origin}`)
    }
    let revokedOAuthCallback
    let revokedOAuthCookie
    try {
      for (const [provider, subject] of [['qq', qqSubject], ['wechat', 'wechat-openid-123']]) {
        const link = await beginLink()
        const started = await request('/v1/auth/link/oauth/start',
          { requestId: link.requestId, provider }, link.headers)
        assert.equal(started.status, 200)
        const { authorizeUrl } = await started.json()
        const authorize = new URL(authorizeUrl)
        const state = authorize.searchParams.get('state')
        const providerCallback = `${base}/v1/auth/oauth/callback/${provider}?code=approved-code-123&state=${state}`
        assert.equal((await fetch(providerCallback)).status, 400)
        const callback = await fetch(providerCallback, { headers: { cookie: link.headers.cookie } })
        assert.equal(callback.status, 200)
        assert.equal((await fetch(providerCallback, { headers: { cookie: link.headers.cookie } })).status, 400)
        const [identities] = await pool.execute(
          'SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?', [provider, subject]
        )
        assert.equal(identities[0].user_id, user.id)
      }
      qqSubject = 'qq-owned-by-other'
      await pool.execute('INSERT INTO auth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)',
        ['qq', qqSubject, otherUser, Date.now()])
      const qqConflict = await beginLink()
      const started = await request('/v1/auth/link/oauth/start',
        { requestId: qqConflict.requestId, provider: 'qq' }, qqConflict.headers)
      const { authorizeUrl } = await started.json()
      const state = new URL(authorizeUrl).searchParams.get('state')
      const callback = await fetch(`${base}/v1/auth/oauth/callback/qq?code=approved-code-123&state=${state}`,
        { headers: { cookie: qqConflict.headers.cookie } })
      assert.equal(callback.status, 409)
      const [unchanged] = await pool.execute(
        'SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?', ['qq', qqSubject]
      )
      assert.equal(unchanged[0].user_id, otherUser)
      const revokedOAuthLink = await beginLink()
      const revokedOAuthStart = await request('/v1/auth/link/oauth/start',
        { requestId: revokedOAuthLink.requestId, provider: 'qq' }, revokedOAuthLink.headers)
      assert.equal(revokedOAuthStart.status, 200)
      const revokedOAuthState = new URL((await revokedOAuthStart.json()).authorizeUrl).searchParams.get('state')
      revokedOAuthCallback = `${base}/v1/auth/oauth/callback/qq?code=approved-code-123&state=${revokedOAuthState}`
      revokedOAuthCookie = revokedOAuthLink.headers.cookie
    } finally { globalThis.fetch = originalFetch }

    const abandonedLink = await beginLink()
    assert.equal((await request('/v1/auth/logout', {}, authHeaders)).status, 200)
    assert.equal((await fetch(`${base}/v1/auth/session`, { headers: authHeaders })).status, 401)
    assert.equal((await fetch(revokedOAuthCallback, { headers: { cookie: revokedOAuthCookie } })).status, 400)
    assert.equal((await fetch(`${base}/link?requestId=${abandonedLink.requestId}`)).status, 410)
    assert.equal((await request('/v1/auth/link/sms/request',
      { requestId: abandonedLink.requestId, phone: '+8613800138003' }, abandonedLink.headers)).status, 403)
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    if (pool) await pool.end()
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await admin.end()
  }
})
