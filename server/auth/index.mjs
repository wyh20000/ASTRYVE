import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import tencentcloud from 'tencentcloud-sdk-nodejs-sms'
import { bearerToken, FixedWindowLimiter, generateSmsCode, newSessionToken, normalizePhone, smsCodeHash, tokenHash, verifySmsCode } from './security.mjs'

const DAY = 86_400_000
const SMS_LIFETIME = 5 * 60_000
const SESSION_LIFETIME = 30 * DAY
const MAX_BODY = 4096
const cfg = {
  host: process.env.AUTH_LISTEN_HOST || '127.0.0.1',
  port: Number(process.env.AUTH_PORT || 8787),
  mysqlUrl: process.env.AUTH_MYSQL_URL,
  codeSecret: process.env.AUTH_CODE_SECRET,
  smsSecretId: process.env.TENCENTCLOUD_SECRET_ID,
  smsSecretKey: process.env.TENCENTCLOUD_SECRET_KEY,
  smsAppId: process.env.TENCENT_SMS_APP_ID,
  smsSign: process.env.TENCENT_SMS_SIGN,
  smsTemplateId: process.env.TENCENT_SMS_TEMPLATE_ID
}

function validateConfig() {
  if (!['127.0.0.1', '::1', 'localhost'].includes(cfg.host)) throw new Error('认证服务仅能绑定本机回环地址；请在前方配置 HTTPS 反向代理')
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error('AUTH_PORT 无效')
  if (!cfg.mysqlUrl) throw new Error('缺少 AUTH_MYSQL_URL')
  if (!cfg.codeSecret || Buffer.byteLength(cfg.codeSecret) < 32) throw new Error('AUTH_CODE_SECRET 至少需要 32 字节')
}

const smsConfigured = () => Boolean(cfg.smsSecretId && cfg.smsSecretKey && cfg.smsAppId && cfg.smsSign && cfg.smsTemplateId)
const ipLimiter = new FixedWindowLimiter(120, 60_000)
const smsIpLimiter = new FixedWindowLimiter(10, 60_000)
const smsPhoneLimiter = new FixedWindowLimiter(3, 60 * 60_000)
const verifyLimiter = new FixedWindowLimiter(12, 10 * 60_000)

function response(res, status, body) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'"
  })
  res.end(raw)
}

async function jsonBody(req) {
  const type = req.headers['content-type']?.split(';')[0]?.trim()
  if (type !== 'application/json') throw Object.assign(new Error('需要 JSON 正文'), { status: 415 })
  let total = 0
  const chunks = []
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY) throw Object.assign(new Error('请求过大'), { status: 413 })
    chunks.push(chunk)
  }
  let body
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw Object.assign(new Error('JSON 无效'), { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('参数无效'), { status: 400 })
  return body
}

async function sendSms(phone, code) {
  if (!smsConfigured()) throw Object.assign(new Error('短信登录尚未配置'), { status: 503 })
  const client = new tencentcloud.sms.v20210111.Client({
    credential: { secretId: cfg.smsSecretId, secretKey: cfg.smsSecretKey },
    region: 'ap-guangzhou', profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } }
  })
  const result = await client.SendSms({
    SmsSdkAppId: cfg.smsAppId, SignName: cfg.smsSign, TemplateId: cfg.smsTemplateId,
    TemplateParamSet: [code, '5'], PhoneNumberSet: [phone]
  })
  if (result.SendStatusSet?.[0]?.Code !== 'Ok') throw new Error('短信网关拒绝发送')
}

async function requireSession(req, pool) {
  const token = bearerToken(req.headers.authorization)
  if (!token) throw Object.assign(new Error('请先登录'), { status: 401 })
  const [rows] = await pool.execute(
    'SELECT user_id FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1',
    [tokenHash(token), Date.now()]
  )
  if (!rows.length) throw Object.assign(new Error('登录已失效'), { status: 401 })
  return { userId: rows[0].user_id, token }
}

async function requestSms(req, res, pool, ip) {
  if (!smsConfigured()) return response(res, 503, { error: '短信登录尚未配置' })
  const { phone: rawPhone } = await jsonBody(req)
  const phone = normalizePhone(rawPhone)
  if (!smsIpLimiter.allow(ip) || !smsPhoneLimiter.allow(phone)) return response(res, 429, { error: '请求过于频繁，请稍后再试' })
  const now = Date.now()
  const [existing] = await pool.execute('SELECT sent_at FROM auth_sms_challenges WHERE phone = ?', [phone])
  if (existing.length && now - Number(existing[0].sent_at) < 60_000) return response(res, 429, { error: '请求过于频繁，请稍后再试' })
  const code = generateSmsCode()
  await pool.execute(
    'INSERT INTO auth_sms_challenges (phone, code_hash, expires_at, sent_at, attempts) VALUES (?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), sent_at = VALUES(sent_at), attempts = 0',
    [phone, smsCodeHash(cfg.codeSecret, phone, code), now + SMS_LIFETIME, now]
  )
  try { await sendSms(phone, code) }
  catch {
    await pool.execute('DELETE FROM auth_sms_challenges WHERE phone = ? AND sent_at = ?', [phone, now])
    return response(res, 503, { error: '短信暂时无法发送' })
  }
  return response(res, 202, { ok: true, expiresInSeconds: 300 })
}

async function verifySms(req, res, pool, ip) {
  const { phone: rawPhone, code } = await jsonBody(req)
  const phone = normalizePhone(rawPhone)
  if (!verifyLimiter.allow(`${ip}:${phone}`)) return response(res, 429, { error: '尝试过于频繁，请稍后再试' })
  const db = await pool.getConnection()
  try {
    await db.beginTransaction()
    const now = Date.now()
    const [rows] = await db.execute('SELECT code_hash, expires_at, attempts FROM auth_sms_challenges WHERE phone = ? FOR UPDATE', [phone])
    const challenge = rows[0]
    const valid = challenge && Number(challenge.expires_at) > now && Number(challenge.attempts) < 5 &&
      verifySmsCode(cfg.codeSecret, phone, code, challenge.code_hash)
    if (!valid) {
      if (challenge) await db.execute('UPDATE auth_sms_challenges SET attempts = attempts + 1 WHERE phone = ?', [phone])
      await db.commit()
      return response(res, 401, { error: '验证码无效或已过期' })
    }
    await db.execute('DELETE FROM auth_sms_challenges WHERE phone = ?', [phone])
    const [identities] = await db.execute('SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ? FOR UPDATE', ['phone', phone])
    let userId = identities[0]?.user_id
    if (!userId) {
      userId = randomUUID()
      await db.execute('INSERT INTO auth_users (id, created_at) VALUES (?, ?)', [userId, now])
      await db.execute('INSERT INTO auth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)', ['phone', phone, userId, now])
    }
    const token = newSessionToken()
    await db.execute('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [tokenHash(token), userId, now, now + SESSION_LIFETIME])
    await db.commit()
    return response(res, 200, { token, user: { id: userId }, expiresAt: now + SESSION_LIFETIME })
  } catch (error) { await db.rollback(); throw error }
  finally { db.release() }
}

async function handler(req, res, pool) {
  const ip = req.socket.remoteAddress || 'unknown'
  if (!ipLimiter.allow(ip)) return response(res, 429, { error: '请求过于频繁' })
  const url = new URL(req.url || '/', 'http://localhost')
  if (url.search) return response(res, 400, { error: '查询参数不受支持' })
  if (req.method === 'GET' && url.pathname === '/health') return response(res, 200, { ok: true })
  if (req.method === 'GET' && url.pathname === '/v1/auth/methods') return response(res, 200, { phone: smsConfigured(), qq: false, wechat: false })
  if (req.method === 'POST' && url.pathname === '/v1/auth/sms/request') return requestSms(req, res, pool, ip)
  if (req.method === 'POST' && url.pathname === '/v1/auth/sms/verify') return verifySms(req, res, pool, ip)
  // Every other endpoint, including unknown paths, requires a valid session.
  const session = await requireSession(req, pool)
  if (req.method === 'GET' && url.pathname === '/v1/auth/session') return response(res, 200, { user: { id: session.userId } })
  if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
    await pool.execute('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?', [Date.now(), tokenHash(session.token)])
    return response(res, 200, { ok: true })
  }
  return response(res, 404, { error: '接口不存在' })
}

export function createAuthRequestHandler(pool) {
  return (req, res) => {
    Promise.resolve(handler(req, res, pool)).catch((error) => {
      if (res.headersSent) { res.destroy(); return }
      const status = Number.isInteger(error?.status) ? error.status : error instanceof TypeError ? 400 : 500
      if (status === 500) console.error('[auth] request failed:', error?.message)
      response(res, status, { error: status === 500 ? '服务暂时不可用' : error.message })
    })
  }
}

export async function startAuthServer() {
  validateConfig()
  const pool = mysql.createPool({ uri: cfg.mysqlUrl, connectionLimit: 10, waitForConnections: true, queueLimit: 100, multipleStatements: false })
  const schema = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8')
  for (const statement of schema.split(';').map((s) => s.trim()).filter(Boolean)) await pool.query(statement)
  const server = createServer(createAuthRequestHandler(pool))
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  server.maxRequestsPerSocket = 100
  server.listen(cfg.port, cfg.host, () => console.log(`[auth] listening on ${cfg.host}:${cfg.port}`))
  return { server, pool }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startAuthServer().catch((error) => { console.error('[auth] startup failed:', error.message); process.exitCode = 1 })
}
