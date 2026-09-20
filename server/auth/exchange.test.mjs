import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createAuthRequestHandler } from './index.mjs'
import { codeChallenge, randomFlowId, randomSecret, sha256 } from './desktopProtocol.mjs'

test('desktop code requires PKCE and exact callback, then can be exchanged once', async () => {
  const requestId = randomFlowId()
  const code = randomSecret()
  const verifier = randomSecret()
  const userId = 'a2f74254-b2b2-4e32-9189-d9a098ee745d'
  const redirectUri = 'http://127.0.0.1:40321/auth/callback'
  const authorization = { flow_id: requestId, user_id: userId, expires_at: Date.now() + 60_000, consumed_at: null }
  const flow = { redirect_uri: redirectUri, code_challenge: codeChallenge(verifier), status: 'completed' }
  const sessions = []
  const db = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql, values) => {
      if (sql.startsWith('SELECT flow_id, user_id')) return [[values[0] === sha256(code) ? authorization : undefined].filter(Boolean)]
      if (sql.startsWith('SELECT redirect_uri, code_challenge')) return [[flow]]
      if (sql.startsWith('UPDATE auth_desktop_codes')) { authorization.consumed_at = values[0]; return [{ affectedRows: 1 }] }
      if (sql.startsWith('INSERT INTO auth_sessions')) { sessions.push(values); return [{ affectedRows: 1 }] }
      throw Error(`Unexpected SQL: ${sql}`)
    }
  }
  const server = createServer(createAuthRequestHandler({ getConnection: async () => db }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const exchange = (patch = {}) => fetch(`${base}/v1/auth/desktop/exchange`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, code, verifier, redirectUri, ...patch })
    })
    assert.equal((await exchange({ verifier: randomSecret() })).status, 401)
    assert.equal((await exchange({ redirectUri: 'http://127.0.0.1:40322/auth/callback' })).status, 401)
    assert.equal(sessions.length, 0)
    const first = await exchange()
    assert.equal(first.status, 200)
    const result = await first.json()
    assert.equal(result.user.id, userId)
    assert.match(result.token, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(sessions.length, 1)
    assert.equal((await exchange()).status, 401)
    assert.equal(sessions.length, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
