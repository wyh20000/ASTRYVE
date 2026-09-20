import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callbackUri, codeChallenge, equalHash, isFlowId, isSecret, publicOrigin, randomFlowId, randomSecret, sha256 } from './desktopProtocol.mjs'

test('desktop callback only accepts loopback IP, a real port and exact path', () => {
  assert.equal(callbackUri('http://127.0.0.1:49152/auth/callback'), 'http://127.0.0.1:49152/auth/callback')
  for (const uri of ['http://localhost:49152/auth/callback', 'http://127.0.0.1:0/auth/callback',
    'http://127.0.0.1:65536/auth/callback', 'http://127.0.0.1:49152/other',
    'http://127.0.0.1:49152/auth/callback?x=1', 'https://evil.example/auth/callback']) {
    assert.throws(() => callbackUri(uri))
  }
})

test('PKCE S256 and IDs are strict and unpredictable', () => {
  const verifier = randomSecret()
  assert.equal(isSecret(verifier), true)
  assert.equal(codeChallenge(verifier).length, 43)
  assert.equal(isFlowId(randomFlowId()), true)
  assert.notEqual(randomFlowId(), randomFlowId())
  assert.throws(() => codeChallenge('short'))
  assert.equal(equalHash(sha256('a'), sha256('a')), true)
  assert.equal(equalHash(sha256('a'), sha256('b')), false)
})

test('public origin requires HTTPS except explicit local development', () => {
  assert.equal(publicOrigin('https://login.example.com'), 'https://login.example.com')
  assert.throws(() => publicOrigin('http://login.example.com'))
  assert.throws(() => publicOrigin('https://login.example.com/path'))
  assert.equal(publicOrigin('http://127.0.0.1:8787', true), 'http://127.0.0.1:8787')
})
