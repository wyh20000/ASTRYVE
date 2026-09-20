import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { codeChallenge, randomSecret } from './desktopProtocol.mjs'

process.env.AUTH_PUBLIC_URL = 'http://127.0.0.1:8787'
process.env.AUTH_INSECURE_LOCAL_DEV = '1'
const { createAuthRequestHandler } = await import('./index.mjs')

test('Web SMS and OAuth requests require the issued cookie, CSRF and exact Origin', async () => {
  const flows = new Map()
  const pool = { execute: async (sql, values) => {
    if (sql.startsWith('INSERT INTO auth_desktop_flows')) {
      flows.set(values[0], { status: values[4], expires_at: values[6] })
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('SELECT status, expires_at FROM auth_desktop_flows')) return [[flows.get(values[0])].filter(Boolean)]
    if (sql.startsWith('UPDATE auth_desktop_flows SET browser_cookie_hash')) {
      const flow = flows.get(values[2])
      if (!flow || flow.status !== 'pending') return [{ affectedRows: 0 }]
      flow.browser_cookie_hash = values[0]
      flow.csrf_hash = values[1]
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('SELECT browser_cookie_hash, csrf_hash')) return [[flows.get(values[0])].filter(Boolean)]
    throw Error(`Unexpected SQL: ${sql}`)
  } }
  const server = createServer(createAuthRequestHandler(pool))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const start = await fetch(`${base}/v1/auth/desktop/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirectUri: 'http://127.0.0.1:40321/auth/callback',
        state: randomSecret(), codeChallenge: codeChallenge(randomSecret()) })
    })
    assert.equal(start.status, 200)
    const { requestId } = await start.json()
    const page = await fetch(`${base}/login?requestId=${requestId}`)
    assert.equal(page.status, 200)
    const cookie = page.headers.get('set-cookie').split(';')[0]
    const html = await page.text()
    const csrf = html.match(/data-csrf="([A-Za-z0-9_-]{43})"/)[1]
    const submit = (path, headers = {}) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ requestId, phone: '+8613800138000', provider: 'qq' })
    })
    assert.equal((await submit('/v1/auth/sms/request')).status, 403)
    assert.equal((await submit('/v1/auth/sms/request', { cookie, origin: 'https://evil.example', 'x-csrf-token': csrf })).status, 403)
    assert.equal((await submit('/v1/auth/sms/request', { cookie, origin: process.env.AUTH_PUBLIC_URL, 'x-csrf-token': randomSecret() })).status, 403)
    assert.equal((await submit('/v1/auth/sms/request', { cookie, origin: process.env.AUTH_PUBLIC_URL, 'x-csrf-token': csrf })).status, 503)
    assert.equal((await submit('/v1/auth/oauth/start', { cookie, origin: process.env.AUTH_PUBLIC_URL, 'x-csrf-token': csrf })).status, 503)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
