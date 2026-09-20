import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bearerToken, FixedWindowLimiter, generateSmsCode, newSessionToken, normalizePhone, smsCodeHash, tokenHash, verifySmsCode } from './security.mjs'

test('Chinese mobile numbers use one canonical form', () => {
  assert.equal(normalizePhone('+86 13800138000'), '+8613800138000')
  for (const bad of ['13800138000', '+8612800138000', '+86138001380000', '']) {
    assert.throws(() => normalizePhone(bad))
  }
})

test('codes are six digits and verification is bound to phone and secret', () => {
  const code = generateSmsCode()
  assert.match(code, /^\d{6}$/)
  const hash = smsCodeHash('server-secret', '+8613800138000', code)
  assert.equal(verifySmsCode('server-secret', '+8613800138000', code, hash), true)
  assert.equal(verifySmsCode('server-secret', '+8613900139000', code, hash), false)
  assert.equal(verifySmsCode('wrong', '+8613800138000', code, hash), false)
  assert.equal(verifySmsCode('server-secret', '+8613800138000', '12345', hash), false)
})

test('session tokens are random bearer values and only hashes need persistence', () => {
  const a = newSessionToken()
  const b = newSessionToken()
  assert.notEqual(a, b)
  assert.equal(bearerToken(`Bearer ${a}`), a)
  assert.equal(bearerToken(`Basic ${a}`), undefined)
  assert.notEqual(tokenHash(a), a)
})

test('limiter enforces a bounded window', () => {
  const limiter = new FixedWindowLimiter(2, 1000)
  assert.equal(limiter.allow('phone', 0), true)
  assert.equal(limiter.allow('phone', 1), true)
  assert.equal(limiter.allow('phone', 2), false)
  assert.equal(limiter.allow('other', 2), true)
  assert.equal(limiter.allow('phone', 1000), true)
})
