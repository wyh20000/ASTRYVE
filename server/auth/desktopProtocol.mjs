import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/
const FLOW_ID = /^[A-Za-z0-9_-]{32}$/
const CALLBACK = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/auth\/callback$/

export function randomSecret() { return randomBytes(32).toString('base64url') }
export function randomFlowId() { return randomBytes(24).toString('base64url') }
export function sha256(value) { return createHash('sha256').update(value).digest('hex') }
export function codeChallenge(verifier) {
  if (!BASE64URL_32.test(verifier)) throw new TypeError('PKCE verifier 无效')
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}
export function isSecret(value) { return typeof value === 'string' && BASE64URL_32.test(value) }
export function isFlowId(value) { return typeof value === 'string' && FLOW_ID.test(value) }
export function callbackUri(value) {
  if (typeof value !== 'string') throw new TypeError('回调地址无效')
  const match = CALLBACK.exec(value)
  if (!match || Number(match[1]) > 65535) throw new TypeError('回调地址无效')
  return value
}
export function equalHash(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}
export function publicOrigin(raw, allowLocalHttp = false) {
  const url = new URL(raw)
  const local = allowLocalHttp && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('AUTH_PUBLIC_URL 必须是 HTTPS origin')
  }
  return url.origin
}
