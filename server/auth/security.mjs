import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function normalizePhone(value) {
  if (typeof value !== 'string') throw new TypeError('手机号格式无效')
  const phone = value.replace(/[\s-]/g, '')
  if (!/^\+86(?:1[3-9]\d{9})$/.test(phone)) throw new TypeError('手机号格式无效')
  return phone
}

export function generateSmsCode() {
  const limit = 0x100000000 - (0x100000000 % 1000000)
  let n
  do { n = randomBytes(4).readUInt32BE() } while (n >= limit)
  return String(n % 1000000).padStart(6, '0')
}

export function smsCodeHash(secret, phone, code) {
  return createHmac('sha256', secret).update(`sms:${phone}:${code}`).digest('hex')
}

export function verifySmsCode(secret, phone, code, expectedHex) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(expectedHex)) return false
  const actual = Buffer.from(smsCodeHash(secret, phone, code), 'hex')
  return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'))
}

export function newSessionToken() { return randomBytes(32).toString('base64url') }
export function tokenHash(token) { return createHash('sha256').update(token).digest('hex') }

export function bearerToken(header) {
  if (typeof header !== 'string') return undefined
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header)
  return match?.[1]
}

export class FixedWindowLimiter {
  #entries = new Map()
  constructor(limit, durationMs) { this.limit = limit; this.durationMs = durationMs }
  allow(key, now = Date.now()) {
    const record = this.#entries.get(key)
    if (!record || now >= record.until) {
      if (this.#entries.size >= 100_000) {
        for (const [name, item] of this.#entries) if (now >= item.until) this.#entries.delete(name)
        if (this.#entries.size >= 100_000 && !record) return false
      }
      this.#entries.set(key, { count: 1, until: now + this.durationMs })
      return true
    }
    if (record.count >= this.limit) return false
    record.count++
    return true
  }
}
