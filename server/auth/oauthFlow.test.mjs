import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { codeChallenge, randomSecret, sha256 } from './desktopProtocol.mjs'

process.env.AUTH_PUBLIC_URL = 'http://127.0.0.1:8787'
process.env.AUTH_INSECURE_LOCAL_DEV = '1'
process.env.QQ_CLIENT_ID = 'approved-qq-app'
process.env.QQ_CLIENT_SECRET = 'server-only-secret'
const { createAuthRequestHandler } = await import('./index.mjs')

test('QQ OAuth callback is bound to browser cookie and state, then yields a one-time desktop code', async () => {
  const flows = new Map()
  const states = new Map()
  const identities = new Map()
  const desktopCodes = []
  const db = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql, values) => {
      if (sql.startsWith('INSERT INTO auth_desktop_flows')) {
        flows.set(values[0], { redirect_uri: values[1], state: values[2], code_challenge: values[3], status: values[4], expires_at: values[6] })
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('SELECT status, expires_at FROM auth_desktop_flows')) return [[flows.get(values[0])].filter(Boolean)]
      if (sql.startsWith('UPDATE auth_desktop_flows SET browser_cookie_hash')) {
        const flow = flows.get(values[2]); flow.browser_cookie_hash = values[0]; flow.csrf_hash = values[1]
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('SELECT browser_cookie_hash, csrf_hash')) return [[flows.get(values[0])].filter(Boolean)]
      if (sql.startsWith('INSERT INTO auth_oauth_states')) {
        states.set(values[0], { flow_id: values[1], provider: values[2], browser_cookie_hash: values[3], expires_at: values[4], consumed_at: null })
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('SELECT flow_id, provider, browser_cookie_hash')) return [[states.get(values[0])].filter(Boolean)]
      if (sql.startsWith('UPDATE auth_oauth_states')) { states.get(values[1]).consumed_at = values[0]; return [{ affectedRows: 1 }] }
      if (sql.startsWith('SELECT redirect_uri, state, status')) return [[flows.get(values[0])].filter(Boolean)]
      if (sql.startsWith('SELECT user_id FROM auth_identities')) return [[identities.get(`${values[0]}:${values[1]}`)].filter(Boolean).map((user_id) => ({ user_id }))]
      if (sql.startsWith('INSERT INTO auth_users')) return [{ affectedRows: 1 }]
      if (sql.startsWith('INSERT INTO auth_identities')) { identities.set(`${values[0]}:${values[1]}`, values[2]); return [{ affectedRows: 1 }] }
      if (sql.startsWith('INSERT INTO auth_desktop_codes')) { desktopCodes.push(values); return [{ affectedRows: 1 }] }
      if (sql.startsWith('UPDATE auth_desktop_flows SET status')) { flows.get(values[1]).status = values[0]; return [{ affectedRows: 1 }] }
      throw Error(`Unexpected SQL: ${sql}`)
    }
  }
  const server = createServer(createAuthRequestHandler({ execute: db.execute, getConnection: async () => db }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const nativeFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url)
    if (parsed.hostname !== 'graph.qq.com') return nativeFetch(url, init)
    const body = parsed.pathname.endsWith('/token')
      ? { access_token: 'qq_valid_token_123' }
      : { client_id: 'approved-qq-app', openid: 'qqopenid123456' }
    return new Response(JSON.stringify(body), { status: 200 })
  }
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const desktopState = randomSecret()
    const start = await nativeFetch(`${base}/v1/auth/desktop/start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirectUri: 'http://127.0.0.1:40321/auth/callback', state: desktopState, codeChallenge: codeChallenge(randomSecret()) }) })
    const { requestId } = await start.json()
    const page = await nativeFetch(`${base}/login?requestId=${requestId}`)
    const cookie = page.headers.get('set-cookie').split(';')[0]
    const csrf = (await page.text()).match(/data-csrf="([A-Za-z0-9_-]{43})"/)[1]
    const oauthStart = await nativeFetch(`${base}/v1/auth/oauth/start`, { method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: process.env.AUTH_PUBLIC_URL, 'x-csrf-token': csrf },
      body: JSON.stringify({ requestId, provider: 'qq' }) })
    assert.equal(oauthStart.status, 200)
    const authorize = new URL((await oauthStart.json()).authorizeUrl)
    const providerState = authorize.searchParams.get('state')
    assert.equal(authorize.origin, 'https://graph.qq.com')
    const callbackUrl = `${base}/v1/auth/oauth/callback/qq?code=oauthcode123&state=${providerState}`
    assert.equal((await nativeFetch(callbackUrl)).status, 400)
    assert.equal(states.get(sha256(providerState)).consumed_at, null)
    const callback = await nativeFetch(callbackUrl, { headers: { cookie }, redirect: 'manual' })
    assert.equal(callback.status, 302)
    const redirect = new URL(callback.headers.get('location'))
    assert.equal(redirect.origin, 'http://127.0.0.1:40321')
    assert.equal(redirect.searchParams.get('state'), desktopState)
    assert.match(redirect.searchParams.get('code'), /^[A-Za-z0-9_-]{43}$/)
    assert.equal(desktopCodes.length, 1)
    assert.equal((await nativeFetch(callbackUrl, { headers: { cookie } })).status, 400)
    assert.equal(desktopCodes.length, 1)
  } finally {
    globalThis.fetch = nativeFetch
    await new Promise((resolve) => server.close(resolve))
  }
})
