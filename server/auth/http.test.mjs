import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createAuthRequestHandler } from './index.mjs'

test('only documented public routes work without a session', async () => {
  const pool = { execute: async () => [[]] }
  const server = createServer(createAuthRequestHandler(pool))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const health = await fetch(`${base}/health`)
    assert.equal(health.status, 200)
    const methods = await fetch(`${base}/v1/auth/methods`)
    assert.equal(methods.status, 200)
    assert.deepEqual(await methods.json(), { phone: false, qq: false, wechat: false })
    const unknown = await fetch(`${base}/private`)
    assert.equal(unknown.status, 401)
    const session = await fetch(`${base}/v1/auth/session`)
    assert.equal(session.status, 401)
    const smsBypass = await fetch(`${base}/v1/auth/sms/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+8613800138000', code: '123456' })
    })
    assert.equal(smsBypass.status, 403)
    const fakeSession = await fetch(`${base}/v1/auth/session`, {
      headers: { authorization: `Bearer ${'A'.repeat(43)}` }
    })
    assert.equal(fakeSession.status, 401)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
