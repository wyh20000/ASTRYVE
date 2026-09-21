import test from 'node:test'
import assert from 'node:assert/strict'
import { clientIp } from './clientIp.mjs'

test('proxy client IP is accepted only from loopback and a single valid header', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '203.0.113.7' } }
  assert.equal(clientIp(req, false), '127.0.0.1')
  assert.equal(clientIp(req, true), '203.0.113.7')
  for (const header of [undefined, '203.0.113.7, 198.51.100.2', '203.0.113.7 ', 'not-an-ip']) {
    req.headers['x-real-ip'] = header
    assert.throws(() => clientIp(req, true), { status: 400 })
  }
  req.headers['x-real-ip'] = '203.0.113.7'
  req.socket.remoteAddress = '198.51.100.2'
  assert.throws(() => clientIp(req, true), { status: 400 })
})
