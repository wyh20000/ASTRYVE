import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import tencentcloud from 'tencentcloud-sdk-nodejs-sms'
import { bearerToken, FixedWindowLimiter, generateSmsCode, newSessionToken, normalizePhone, smsCodeHash, tokenHash, verifySmsCode } from './security.mjs'
import { callbackUri, codeChallenge, equalHash, isFlowId, isSecret, publicOrigin, randomFlowId, randomSecret, sha256 } from './desktopProtocol.mjs'
import { exchangeProviderIdentity, providerAuthorizeUrl, providerEnabled } from './oauthProviders.mjs'

const DAY = 86_400_000
const SMS_LIFETIME = 5 * 60_000
const SESSION_LIFETIME = 30 * DAY
const FLOW_LIFETIME = 10 * 60_000
const CODE_LIFETIME = 60_000
const MAX_BODY = 4096
const cfg = {
  host: process.env.AUTH_LISTEN_HOST || '127.0.0.1',
  port: Number(process.env.AUTH_PORT || 8787),
  mysqlUrl: process.env.AUTH_MYSQL_URL,
  publicUrl: process.env.AUTH_PUBLIC_URL,
  insecureLocalDev: process.env.AUTH_INSECURE_LOCAL_DEV === '1',
  codeSecret: process.env.AUTH_CODE_SECRET,
  smsSecretId: process.env.TENCENTCLOUD_SECRET_ID,
  smsSecretKey: process.env.TENCENTCLOUD_SECRET_KEY,
  smsAppId: process.env.TENCENT_SMS_APP_ID,
  smsSign: process.env.TENCENT_SMS_SIGN,
  smsTemplateId: process.env.TENCENT_SMS_TEMPLATE_ID
}
const oauthConfig = {
  qq: { clientId: process.env.QQ_CLIENT_ID, clientSecret: process.env.QQ_CLIENT_SECRET },
  wechat: { clientId: process.env.WECHAT_CLIENT_ID, clientSecret: process.env.WECHAT_CLIENT_SECRET }
}

function validateConfig() {
  if (!['127.0.0.1', '::1', 'localhost'].includes(cfg.host)) throw new Error('认证服务仅能绑定本机回环地址；请在前方配置 HTTPS 反向代理')
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error('AUTH_PORT 无效')
  if (!cfg.mysqlUrl) throw new Error('缺少 AUTH_MYSQL_URL')
  if (!cfg.publicUrl) throw new Error('缺少 AUTH_PUBLIC_URL')
  cfg.publicUrl = publicOrigin(cfg.publicUrl, cfg.insecureLocalDev)
  if (!cfg.codeSecret || Buffer.byteLength(cfg.codeSecret) < 32) throw new Error('AUTH_CODE_SECRET 至少需要 32 字节')
}

const smsConfigured = () => Boolean(cfg.smsSecretId && cfg.smsSecretKey && cfg.smsAppId && cfg.smsSign && cfg.smsTemplateId)
const ipLimiter = new FixedWindowLimiter(120, 60_000)
const smsIpLimiter = new FixedWindowLimiter(10, 60_000)
const smsPhoneLimiter = new FixedWindowLimiter(3, 60 * 60_000)
const verifyLimiter = new FixedWindowLimiter(12, 10 * 60_000)

function response(res, status, body, headers = {}) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'",
    ...headers
  })
  res.end(raw)
}

function htmlResponse(res, status, html, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    ...headers
  })
  res.end(html)
}

function staticResponse(res, type, content) {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" })
  res.end(content)
}

function browserCookie(req) {
  const cookieName = cfg.insecureLocalDev ? 'aiagent_flow_dev' : '__Host-aiagent_flow'
  const entry = (req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
  const value = entry?.slice(cookieName.length + 1)
  return isSecret(value) ? value : undefined
}

async function startDesktopFlow(req, res, pool) {
  const { redirectUri, state, codeChallenge: challenge } = await jsonBody(req)
  callbackUri(redirectUri)
  if (!isSecret(state) || !isSecret(challenge)) throw new TypeError('登录请求参数无效')
  const id = randomFlowId()
  const now = Date.now()
  await pool.execute(
    'INSERT INTO auth_desktop_flows (id, redirect_uri, state, code_challenge, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, redirectUri, state, challenge, 'pending', now, now + FLOW_LIFETIME]
  )
  return response(res, 200, { requestId: id, loginUrl: `${cfg.publicUrl}/login?requestId=${id}`, expiresAt: now + FLOW_LIFETIME })
}

async function showLogin(res, pool, requestId) {
  if (!isFlowId(requestId)) return htmlResponse(res, 400, '<h1>登录链接无效</h1>')
  const [rows] = await pool.execute('SELECT status, expires_at FROM auth_desktop_flows WHERE id = ?', [requestId])
  if (!rows[0] || rows[0].status !== 'pending' || Number(rows[0].expires_at) <= Date.now()) {
    return htmlResponse(res, 410, '<h1>登录链接已失效，请返回客户端重试</h1>')
  }
  const cookie = randomSecret()
  const csrf = randomSecret()
  const [updated] = await pool.execute('UPDATE auth_desktop_flows SET browser_cookie_hash = ?, csrf_hash = ? WHERE id = ? AND status = ? AND expires_at > ?', [sha256(cookie), sha256(csrf), requestId, 'pending', Date.now()])
  if (updated.affectedRows !== 1) return htmlResponse(res, 410, '<h1>登录链接已失效，请返回客户端重试</h1>')
  const cookieName = cfg.insecureLocalDev ? 'aiagent_flow_dev' : '__Host-aiagent_flow'
  const secure = cfg.insecureLocalDev ? '' : '; Secure'
  const page = readFileSync(fileURLToPath(new URL('./web/login.html', import.meta.url)), 'utf8')
    .replaceAll('__FLOW_ID__', requestId).replaceAll('__CSRF_TOKEN__', csrf)
  return htmlResponse(res, 200, page, { 'set-cookie': `${cookieName}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}` })
}

async function startLinkFlow(res, pool, userId, token) {
  const requestId = randomFlowId()
  const now = Date.now()
  await pool.execute(
    'INSERT INTO auth_link_flows (id, user_id, session_hash, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [requestId, userId, tokenHash(token), 'pending', now, now + FLOW_LIFETIME]
  )
  return response(res, 200, { requestId, linkUrl: `${cfg.publicUrl}/link?requestId=${requestId}`,
    expiresAt: now + FLOW_LIFETIME })
}

async function showLink(res, pool, requestId) {
  if (!isFlowId(requestId)) return htmlResponse(res, 400, '<h1>绑定链接无效</h1>')
  const [rows] = await pool.execute('SELECT status, expires_at, session_hash FROM auth_link_flows WHERE id = ?', [requestId])
  if (!rows[0] || !(await linkSessionActive(pool, rows[0].session_hash)) ||
      rows[0].status !== 'pending' || Number(rows[0].expires_at) <= Date.now()) {
    return htmlResponse(res, 410, '<h1>绑定链接已失效，请返回客户端重试</h1>')
  }
  const cookie = randomSecret()
  const csrf = randomSecret()
  const [updated] = await pool.execute(
    'UPDATE auth_link_flows SET browser_cookie_hash = ?, csrf_hash = ? WHERE id = ? AND status = ? AND expires_at > ?',
    [sha256(cookie), sha256(csrf), requestId, 'pending', Date.now()]
  )
  if (updated.affectedRows !== 1) return htmlResponse(res, 410, '<h1>绑定链接已失效，请返回客户端重试</h1>')
  const cookieName = cfg.insecureLocalDev ? 'aiagent_flow_dev' : '__Host-aiagent_flow'
  const secure = cfg.insecureLocalDev ? '' : '; Secure'
  const page = readFileSync(fileURLToPath(new URL('./web/login.html', import.meta.url)), 'utf8')
    .replaceAll('__FLOW_ID__', requestId).replaceAll('__CSRF_TOKEN__', csrf)
    .replace('data-csrf="' + csrf + '"', 'data-csrf="' + csrf + '" data-purpose="link"')
    .replace('<h1>欢迎回来</h1>', '<h1>绑定登录方式</h1>')
    .replace('验证身份，继续你的工作。', '选择一种方式，绑定到当前已登录账号。')
    .replace('登录 / 注册', '验证并绑定')
    .replace('QQ 登录', '绑定 QQ').replace('微信登录', '绑定微信')
    .replace('只在本页面输入验证码；完成后将返回客户端。', '请确认由你本人发起；已有其他账号的身份不会被合并。')
  return htmlResponse(res, 200, page, { 'set-cookie': `${cookieName}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}` })
}

async function requireLinkFlow(req, pool, flowId) {
  if (!isFlowId(flowId) || req.headers.origin !== cfg.publicUrl) {
    throw Object.assign(new Error('绑定请求无效'), { status: 403 })
  }
  const cookie = browserCookie(req)
  const csrf = req.headers['x-csrf-token']
  if (!cookie || !isSecret(csrf)) throw Object.assign(new Error('绑定请求无效'), { status: 403 })
  const [rows] = await pool.execute(
    'SELECT user_id, session_hash, browser_cookie_hash, csrf_hash, expires_at, status FROM auth_link_flows WHERE id = ?', [flowId]
  )
  const flow = rows[0]
  if (!flow || !(await linkSessionActive(pool, flow.session_hash)) ||
      flow.status !== 'pending' || Number(flow.expires_at) <= Date.now() ||
      !equalHash(sha256(cookie), flow.browser_cookie_hash) || !equalHash(sha256(csrf), flow.csrf_hash)) {
    throw Object.assign(new Error('绑定请求已失效'), { status: 403 })
  }
  return flow
}

async function linkSessionActive(db, sessionHash, lock = false) {
  const [rows] = await db.execute(
    `SELECT user_id FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [sessionHash, Date.now()]
  )
  return rows.length > 0
}

async function exchangeDesktopCode(req, res, pool) {
  const { requestId, code, verifier, redirectUri } = await jsonBody(req)
  if (!isFlowId(requestId) || !isSecret(code) || !isSecret(verifier)) throw new TypeError('授权码参数无效')
  callbackUri(redirectUri)
  const db = await pool.getConnection()
  try {
    await db.beginTransaction()
    const now = Date.now()
    const [codes] = await db.execute('SELECT flow_id, user_id, expires_at, consumed_at FROM auth_desktop_codes WHERE code_hash = ? FOR UPDATE', [sha256(code)])
    const authCode = codes[0]
    const [flows] = authCode ? await db.execute('SELECT redirect_uri, code_challenge, status FROM auth_desktop_flows WHERE id = ? FOR UPDATE', [requestId]) : [[]]
    const flow = flows[0]
    if (!authCode || authCode.flow_id !== requestId || authCode.consumed_at !== null || Number(authCode.expires_at) <= now ||
        !flow || flow.status !== 'completed' || flow.redirect_uri !== redirectUri || codeChallenge(verifier) !== flow.code_challenge) {
      await db.rollback()
      return response(res, 401, { error: '授权码无效或已过期' })
    }
    const token = newSessionToken()
    await db.execute('UPDATE auth_desktop_codes SET consumed_at = ? WHERE code_hash = ?', [now, sha256(code)])
    await db.execute('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      [tokenHash(token), authCode.user_id, now, now + SESSION_LIFETIME])
    await db.commit()
    return response(res, 200, { token, user: { id: authCode.user_id }, expiresAt: now + SESSION_LIFETIME })
  } catch (error) { await db.rollback(); throw error }
  finally { db.release() }
}

async function requireWebFlow(req, pool, flowId) {
  if (!isFlowId(flowId) || req.headers.origin !== cfg.publicUrl) throw Object.assign(new Error('登录请求无效'), { status: 403 })
  const cookie = browserCookie(req)
  const csrf = req.headers['x-csrf-token']
  if (!cookie || !isSecret(csrf)) throw Object.assign(new Error('登录请求无效'), { status: 403 })
  const [rows] = await pool.execute('SELECT browser_cookie_hash, csrf_hash, expires_at, status FROM auth_desktop_flows WHERE id = ?', [flowId])
  const flow = rows[0]
  if (!flow || flow.status !== 'pending' || Number(flow.expires_at) <= Date.now() ||
      !equalHash(sha256(cookie), flow.browser_cookie_hash) || !equalHash(sha256(csrf), flow.csrf_hash)) {
    throw Object.assign(new Error('登录请求已失效'), { status: 403 })
  }
  return flow
}

async function startProviderLogin(req, res, pool) {
  const { requestId, provider } = await jsonBody(req)
  await requireWebFlow(req, pool, requestId)
  if (!providerEnabled(provider, oauthConfig)) return response(res, 503, { error: '该登录方式尚未配置' })
  const state = randomSecret()
  const callback = `${cfg.publicUrl}/v1/auth/oauth/callback/${provider}`
  const url = providerAuthorizeUrl(provider, oauthConfig, callback, state)
  await pool.execute('INSERT INTO auth_oauth_states (state_hash, flow_id, provider, browser_cookie_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
    [sha256(state), requestId, provider, sha256(browserCookie(req)), Date.now() + FLOW_LIFETIME])
  return response(res, 200, { authorizeUrl: url })
}

async function providerCallback(req, res, pool, provider, code, state) {
  if (!providerEnabled(provider, oauthConfig) || !isSecret(state) ||
      typeof code !== 'string' || code.length < 6 || code.length > 512 || /[\x00-\x20\x7f]/.test(code)) {
    return htmlResponse(res, 400, '<h1>第三方登录无效，请返回登录页重试</h1>')
  }
  const db = await pool.getConnection()
  let requestId
  try {
    await db.beginTransaction()
    const now = Date.now()
    const [states] = await db.execute('SELECT flow_id, provider, browser_cookie_hash, expires_at, consumed_at FROM auth_oauth_states WHERE state_hash = ? FOR UPDATE', [sha256(state)])
    const stored = states[0]
    const [flows] = stored ? await db.execute('SELECT status, expires_at FROM auth_desktop_flows WHERE id = ? FOR UPDATE', [stored.flow_id]) : [[]]
    const cookie = browserCookie(req)
    if (!stored || !cookie || !equalHash(sha256(cookie), stored.browser_cookie_hash) ||
        stored.provider !== provider || stored.consumed_at !== null || Number(stored.expires_at) <= now ||
        !flows[0] || flows[0].status !== 'pending' || Number(flows[0].expires_at) <= now) {
      await db.rollback()
      return htmlResponse(res, 400, '<h1>第三方登录已失效，请返回登录页重试</h1>')
    }
    requestId = stored.flow_id
    await db.execute('UPDATE auth_oauth_states SET consumed_at = ? WHERE state_hash = ?', [now, sha256(state)])
    await db.commit()
  } catch (error) { await db.rollback(); throw error }
  finally { db.release() }

  let subject
  try { subject = await exchangeProviderIdentity(provider, oauthConfig,
    `${cfg.publicUrl}/v1/auth/oauth/callback/${provider}`, code) }
  catch { return htmlResponse(res, 400, '<h1>第三方认证失败，请返回登录页重试</h1>') }

  const commitDb = await pool.getConnection()
  try {
    await commitDb.beginTransaction()
    const now = Date.now()
    const [flows] = await commitDb.execute('SELECT redirect_uri, state, status, expires_at FROM auth_desktop_flows WHERE id = ? FOR UPDATE', [requestId])
    const flow = flows[0]
    if (!flow || flow.status !== 'pending' || Number(flow.expires_at) <= now) {
      await commitDb.rollback()
      return htmlResponse(res, 410, '<h1>登录请求已失效，请返回客户端重试</h1>')
    }
    const [identities] = await commitDb.execute('SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ? FOR UPDATE', [provider, subject])
    let userId = identities[0]?.user_id
    if (!userId) {
      userId = randomUUID()
      await commitDb.execute('INSERT INTO auth_users (id, created_at) VALUES (?, ?)', [userId, now])
      await commitDb.execute('INSERT INTO auth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)', [provider, subject, userId, now])
    }
    const desktopCode = randomSecret()
    await commitDb.execute('INSERT INTO auth_desktop_codes (code_hash, flow_id, user_id, expires_at) VALUES (?, ?, ?, ?)',
      [sha256(desktopCode), requestId, userId, now + CODE_LIFETIME])
    await commitDb.execute('UPDATE auth_desktop_flows SET status = ? WHERE id = ?', ['completed', requestId])
    await commitDb.commit()
    const redirect = new URL(flow.redirect_uri)
    redirect.searchParams.set('code', desktopCode)
    redirect.searchParams.set('state', flow.state)
    res.writeHead(302, { location: redirect.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
    res.end()
  } catch (error) { await commitDb.rollback(); throw error }
  finally { commitDb.release() }
}

async function startLinkProvider(req, res, pool) {
  const { requestId, provider } = await jsonBody(req)
  await requireLinkFlow(req, pool, requestId)
  if (!providerEnabled(provider, oauthConfig)) return response(res, 503, { error: '该登录方式尚未配置' })
  const state = randomSecret()
  const callback = `${cfg.publicUrl}/v1/auth/oauth/callback/${provider}`
  const url = providerAuthorizeUrl(provider, oauthConfig, callback, state)
  await pool.execute(
    'INSERT INTO auth_link_oauth_states (state_hash, flow_id, provider, browser_cookie_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
    [sha256(state), requestId, provider, sha256(browserCookie(req)), Date.now() + FLOW_LIFETIME]
  )
  return response(res, 200, { authorizeUrl: url })
}

async function linkProviderCallback(req, res, pool, provider, code, state) {
  if (!providerEnabled(provider, oauthConfig) || !isSecret(state) ||
      typeof code !== 'string' || code.length < 6 || code.length > 512 || /[\x00-\x20\x7f]/.test(code)) {
    return htmlResponse(res, 400, '<h1>第三方绑定无效，请返回绑定页重试</h1>')
  }
  const db = await pool.getConnection()
  let requestId
  try {
    await db.beginTransaction()
    const now = Date.now()
    const [states] = await db.execute(
      'SELECT flow_id, provider, browser_cookie_hash, expires_at, consumed_at FROM auth_link_oauth_states WHERE state_hash = ? FOR UPDATE',
      [sha256(state)]
    )
    const stored = states[0]
    const [flows] = stored ? await db.execute(
      'SELECT status, expires_at, session_hash FROM auth_link_flows WHERE id = ? FOR UPDATE', [stored.flow_id]
    ) : [[]]
    const cookie = browserCookie(req)
    if (!stored || !cookie || !equalHash(sha256(cookie), stored.browser_cookie_hash) ||
        stored.provider !== provider || stored.consumed_at !== null || Number(stored.expires_at) <= now ||
        !flows[0] || !(await linkSessionActive(db, flows[0].session_hash, true)) ||
        flows[0].status !== 'pending' || Number(flows[0].expires_at) <= now) {
      await db.rollback()
      return htmlResponse(res, 400, '<h1>第三方绑定已失效，请返回绑定页重试</h1>')
    }
    requestId = stored.flow_id
    await db.execute('UPDATE auth_link_oauth_states SET consumed_at = ? WHERE state_hash = ?', [now, sha256(state)])
    await db.commit()
  } catch (error) { await db.rollback(); throw error }
  finally { db.release() }

  let subject
  try {
    subject = await exchangeProviderIdentity(provider, oauthConfig,
      `${cfg.publicUrl}/v1/auth/oauth/callback/${provider}`, code)
  } catch { return htmlResponse(res, 400, '<h1>第三方认证失败，请返回绑定页重试</h1>') }

  const commitDb = await pool.getConnection()
  try {
    await commitDb.beginTransaction()
    const now = Date.now()
    const [flows] = await commitDb.execute(
      'SELECT user_id, session_hash, status, expires_at FROM auth_link_flows WHERE id = ? FOR UPDATE', [requestId]
    )
    const flow = flows[0]
    if (!flow || !(await linkSessionActive(commitDb, flow.session_hash, true)) ||
        flow.status !== 'pending' || Number(flow.expires_at) <= now) {
      await commitDb.rollback()
      return htmlResponse(res, 410, '<h1>绑定请求已失效，请返回客户端重试</h1>')
    }
    const [identities] = await commitDb.execute(
      'SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ? FOR UPDATE', [provider, subject]
    )
    if (identities[0] && identities[0].user_id !== flow.user_id) {
      await commitDb.commit()
      return htmlResponse(res, 409, '<h1>该第三方身份已属于其他账号，无法自动合并</h1>')
    }
    if (!identities[0]) {
      await commitDb.execute(
        'INSERT INTO auth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)',
        [provider, subject, flow.user_id, now]
      )
    }
    await commitDb.execute('UPDATE auth_link_flows SET status = ? WHERE id = ?', ['completed', requestId])
    await commitDb.commit()
    return htmlResponse(res, 200, '<h1>绑定成功，可以返回 AI Agent 客户端</h1>')
  } catch (error) { await commitDb.rollback(); throw error }
  finally { commitDb.release() }
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

async function requestSms(req, res, pool, ip, smsGateway) {
  const { phone: rawPhone, requestId } = await jsonBody(req)
  await requireWebFlow(req, pool, requestId)
  if (!smsGateway.configured) return response(res, 503, { error: '短信登录尚未配置' })
  const phone = normalizePhone(rawPhone)
  if (!smsIpLimiter.allow(ip) || !smsPhoneLimiter.allow(phone)) return response(res, 429, { error: '请求过于频繁，请稍后再试' })
  const now = Date.now()
  const [existing] = await pool.execute('SELECT sent_at FROM auth_sms_challenges WHERE phone = ?', [phone])
  if (existing.length && now - Number(existing[0].sent_at) < 60_000) return response(res, 429, { error: '请求过于频繁，请稍后再试' })
  const code = generateSmsCode()
  await pool.execute(
    'INSERT INTO auth_sms_challenges (phone, flow_id, code_hash, expires_at, sent_at, attempts) VALUES (?, ?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE flow_id = VALUES(flow_id), code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), sent_at = VALUES(sent_at), attempts = 0',
    [phone, requestId, smsCodeHash(cfg.codeSecret, phone, code), now + SMS_LIFETIME, now]
  )
  try { await smsGateway.send(phone, code) }
  catch {
    await pool.execute('DELETE FROM auth_sms_challenges WHERE phone = ? AND sent_at = ?', [phone, now])
    return response(res, 503, { error: '短信暂时无法发送' })
  }
  return response(res, 202, { ok: true, expiresInSeconds: 300 })
}

async function verifySms(req, res, pool, ip) {
  const { phone: rawPhone, code, requestId } = await jsonBody(req)
  await requireWebFlow(req, pool, requestId)
  const phone = normalizePhone(rawPhone)
  if (!verifyLimiter.allow(`${ip}:${phone}`)) return response(res, 429, { error: '尝试过于频繁，请稍后再试' })
  const db = await pool.getConnection()
  try {
    await db.beginTransaction()
    const now = Date.now()
    const [flows] = await db.execute('SELECT redirect_uri, state, browser_cookie_hash, csrf_hash, expires_at, status FROM auth_desktop_flows WHERE id = ? FOR UPDATE', [requestId])
    const flow = flows[0]
    if (!flow || flow.status !== 'pending' || Number(flow.expires_at) <= now ||
        !equalHash(sha256(browserCookie(req)), flow.browser_cookie_hash) ||
        !equalHash(sha256(req.headers['x-csrf-token']), flow.csrf_hash)) {
      await db.rollback()
      return response(res, 403, { error: '登录请求已失效' })
    }
    const [rows] = await db.execute('SELECT flow_id, code_hash, expires_at, attempts FROM auth_sms_challenges WHERE phone = ? FOR UPDATE', [phone])
    const challenge = rows[0]
    const valid = challenge && challenge.flow_id === requestId && Number(challenge.expires_at) > now && Number(challenge.attempts) < 5 &&
      verifySmsCode(cfg.codeSecret, phone, code, challenge.code_hash)
    if (!valid) {
      if (challenge?.flow_id === requestId) await db.execute('UPDATE auth_sms_challenges SET attempts = attempts + 1 WHERE phone = ?', [phone])
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
    const codeForDesktop = randomSecret()
    await db.execute('INSERT INTO auth_desktop_codes (code_hash, flow_id, user_id, expires_at) VALUES (?, ?, ?, ?)',
      [sha256(codeForDesktop), requestId, userId, now + CODE_LIFETIME])
    await db.execute('UPDATE auth_desktop_flows SET status = ? WHERE id = ?', ['completed', requestId])
    await db.commit()
    const redirect = new URL(flow.redirect_uri)
    redirect.searchParams.set('code', codeForDesktop)
    redirect.searchParams.set('state', flow.state)
    return response(res, 200, { redirectUrl: redirect.toString() })
  } catch (error) { await db.rollback(); throw error }
  finally { db.release() }
}

async function requestLinkSms(req, res, pool, ip, smsGateway) {
  const { phone: rawPhone, requestId } = await jsonBody(req)
  await requireLinkFlow(req, pool, requestId)
  if (!smsGateway.configured) return response(res, 503, { error: '短信登录尚未配置' })
  const phone = normalizePhone(rawPhone)
  if (!smsIpLimiter.allow(ip) || !smsPhoneLimiter.allow(phone)) {
    return response(res, 429, { error: '请求过于频繁，请稍后再试' })
  }
  const now = Date.now()
  const [existing] = await pool.execute('SELECT sent_at FROM auth_sms_challenges WHERE phone = ?', [phone])
  if (existing.length && now - Number(existing[0].sent_at) < 60_000) {
    return response(res, 429, { error: '请求过于频繁，请稍后再试' })
  }
  const code = generateSmsCode()
  await pool.execute(
    'INSERT INTO auth_sms_challenges (phone, flow_id, code_hash, expires_at, sent_at, attempts) VALUES (?, ?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE flow_id = VALUES(flow_id), code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), sent_at = VALUES(sent_at), attempts = 0',
    [phone, requestId, smsCodeHash(cfg.codeSecret, phone, code), now + SMS_LIFETIME, now]
  )
  try { await smsGateway.send(phone, code) }
  catch {
    await pool.execute('DELETE FROM auth_sms_challenges WHERE phone = ? AND sent_at = ?', [phone, now])
    return response(res, 503, { error: '短信暂时无法发送' })
  }
  return response(res, 202, { ok: true, expiresInSeconds: 300 })
}

async function verifyLinkSms(req, res, pool, ip) {
  const { phone: rawPhone, code, requestId } = await jsonBody(req)
  await requireLinkFlow(req, pool, requestId)
  const phone = normalizePhone(rawPhone)
  if (!verifyLimiter.allow(`${ip}:${phone}`)) {
    return response(res, 429, { error: '尝试过于频繁，请稍后再试' })
  }
  const db = await pool.getConnection()
  try {
    await db.beginTransaction()
    const now = Date.now()
    const [flows] = await db.execute(
      'SELECT user_id, session_hash, browser_cookie_hash, csrf_hash, status, expires_at FROM auth_link_flows WHERE id = ? FOR UPDATE',
      [requestId]
    )
    const flow = flows[0]
    if (!flow || !(await linkSessionActive(db, flow.session_hash, true)) ||
        flow.status !== 'pending' || Number(flow.expires_at) <= now ||
        !equalHash(sha256(browserCookie(req)), flow.browser_cookie_hash) ||
        !equalHash(sha256(req.headers['x-csrf-token']), flow.csrf_hash)) {
      await db.rollback()
      return response(res, 403, { error: '绑定请求已失效' })
    }
    const [challenges] = await db.execute(
      'SELECT flow_id, code_hash, expires_at, attempts FROM auth_sms_challenges WHERE phone = ? FOR UPDATE', [phone]
    )
    const challenge = challenges[0]
    const valid = challenge && challenge.flow_id === requestId && Number(challenge.expires_at) > now &&
      Number(challenge.attempts) < 5 && verifySmsCode(cfg.codeSecret, phone, code, challenge.code_hash)
    if (!valid) {
      if (challenge?.flow_id === requestId) {
        await db.execute('UPDATE auth_sms_challenges SET attempts = attempts + 1 WHERE phone = ?', [phone])
      }
      await db.commit()
      return response(res, 401, { error: '验证码无效或已过期' })
    }
    await db.execute('DELETE FROM auth_sms_challenges WHERE phone = ?', [phone])
    const [identities] = await db.execute(
      'SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ? FOR UPDATE', ['phone', phone]
    )
    if (identities[0] && identities[0].user_id !== flow.user_id) {
      await db.commit()
      return response(res, 409, { error: '该手机号已属于其他账号，无法自动合并' })
    }
    if (!identities[0]) {
      await db.execute('INSERT INTO auth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)',
        ['phone', phone, flow.user_id, now])
    }
    await db.execute('UPDATE auth_link_flows SET status = ? WHERE id = ?', ['completed', requestId])
    await db.commit()
    return response(res, 200, { linked: true })
  } catch (error) { await db.rollback(); throw error }
  finally { db.release() }
}

async function handler(req, res, pool, smsGateway) {
  const ip = req.socket.remoteAddress || 'unknown'
  if (!ipLimiter.allow(ip)) return response(res, 429, { error: '请求过于频繁' })
  const url = new URL(req.url || '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/login') {
    if (url.searchParams.size !== 1 || !url.searchParams.has('requestId')) return htmlResponse(res, 400, '<h1>登录链接无效</h1>')
    return showLogin(res, pool, url.searchParams.get('requestId'))
  }
  if (req.method === 'GET' && url.pathname === '/link') {
    if (url.searchParams.size !== 1 || !url.searchParams.has('requestId')) return htmlResponse(res, 400, '<h1>绑定链接无效</h1>')
    return showLink(res, pool, url.searchParams.get('requestId'))
  }
  const oauthCallback = /^\/v1\/auth\/oauth\/callback\/(qq|wechat)$/.exec(url.pathname)
  if (req.method === 'GET' && oauthCallback) {
    if (url.searchParams.size !== 2 || !url.searchParams.has('code') || !url.searchParams.has('state')) {
      return htmlResponse(res, 400, '<h1>第三方登录无效，请返回登录页重试</h1>')
    }
    const state = url.searchParams.get('state')
    const [linkStates] = isSecret(state) ? await pool.execute(
      'SELECT state_hash FROM auth_link_oauth_states WHERE state_hash = ?', [sha256(state)]
    ) : [[]]
    if (linkStates.length) {
      return linkProviderCallback(req, res, pool, oauthCallback[1], url.searchParams.get('code'), state)
    }
    return providerCallback(req, res, pool, oauthCallback[1], url.searchParams.get('code'), state)
  }
  if (url.search) return response(res, 400, { error: '查询参数不受支持' })
  if (req.method === 'GET' && url.pathname === '/auth/login.js') {
    return staticResponse(res, 'text/javascript; charset=utf-8', readFileSync(fileURLToPath(new URL('./web/login.js', import.meta.url))))
  }
  if (req.method === 'GET' && url.pathname === '/auth/login.css') {
    return staticResponse(res, 'text/css; charset=utf-8', readFileSync(fileURLToPath(new URL('./web/login.css', import.meta.url))))
  }
  if (req.method === 'GET' && url.pathname === '/health') return response(res, 200, { ok: true })
  if (req.method === 'GET' && url.pathname === '/v1/auth/methods') return response(res, 200, {
    phone: smsGateway.configured, qq: providerEnabled('qq', oauthConfig), wechat: providerEnabled('wechat', oauthConfig)
  })
  if (req.method === 'POST' && url.pathname === '/v1/auth/desktop/start') return startDesktopFlow(req, res, pool)
  if (req.method === 'POST' && url.pathname === '/v1/auth/desktop/exchange') return exchangeDesktopCode(req, res, pool)
  if (req.method === 'POST' && url.pathname === '/v1/auth/sms/request') return requestSms(req, res, pool, ip, smsGateway)
  if (req.method === 'POST' && url.pathname === '/v1/auth/sms/verify') return verifySms(req, res, pool, ip)
  if (req.method === 'POST' && url.pathname === '/v1/auth/oauth/start') return startProviderLogin(req, res, pool)
  if (req.method === 'POST' && url.pathname === '/v1/auth/link/sms/request') {
    return requestLinkSms(req, res, pool, ip, smsGateway)
  }
  if (req.method === 'POST' && url.pathname === '/v1/auth/link/sms/verify') return verifyLinkSms(req, res, pool, ip)
  if (req.method === 'POST' && url.pathname === '/v1/auth/link/oauth/start') return startLinkProvider(req, res, pool)
  // Every other endpoint, including unknown paths, requires a valid session.
  const session = await requireSession(req, pool)
  if (req.method === 'POST' && url.pathname === '/v1/auth/link/start') {
    return startLinkFlow(res, pool, session.userId, session.token)
  }
  if (req.method === 'GET' && url.pathname === '/v1/auth/session') return response(res, 200, { user: { id: session.userId } })
  if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
    await pool.execute('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?', [Date.now(), tokenHash(session.token)])
    return response(res, 200, { ok: true })
  }
  return response(res, 404, { error: '接口不存在' })
}

export function createAuthRequestHandler(pool, smsGateway = { configured: smsConfigured(), send: sendSms }) {
  return (req, res) => {
    Promise.resolve(handler(req, res, pool, smsGateway)).catch((error) => {
      if (res.headersSent) { res.destroy(); return }
      const status = Number.isInteger(error?.status) ? error.status : error instanceof TypeError ? 400 : 500
      if (status === 500) console.error('[auth] request failed:', error?.message)
      response(res, status, { error: status === 500 ? '服务暂时不可用' : error.message })
    })
  }
}

async function cleanupExpired(pool) {
  const now = Date.now()
  await pool.execute('DELETE FROM auth_sms_challenges WHERE expires_at < ?', [now])
  await pool.execute('DELETE FROM auth_oauth_states WHERE expires_at < ? OR flow_id IN (SELECT id FROM auth_desktop_flows WHERE expires_at < ?)', [now, now])
  await pool.execute('DELETE FROM auth_desktop_codes WHERE expires_at < ? OR flow_id IN (SELECT id FROM auth_desktop_flows WHERE expires_at < ?)', [now, now])
  await pool.execute('DELETE FROM auth_desktop_flows WHERE expires_at < ?', [now])
  await pool.execute('DELETE FROM auth_link_oauth_states WHERE expires_at < ? OR flow_id IN (SELECT id FROM auth_link_flows WHERE expires_at < ?)', [now, now])
  await pool.execute('DELETE FROM auth_link_flows WHERE expires_at < ?', [now])
  await pool.execute('DELETE FROM auth_sessions WHERE expires_at < ? OR revoked_at < ?', [now, now - DAY])
}

export async function startAuthServer() {
  validateConfig()
  const pool = mysql.createPool({ uri: cfg.mysqlUrl, connectionLimit: 10, waitForConnections: true, queueLimit: 100, multipleStatements: false })
  const schema = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8')
  for (const statement of schema.split(';').map((s) => s.trim()).filter(Boolean)) await pool.query(statement)
  const [flowColumn] = await pool.query("SHOW COLUMNS FROM auth_sms_challenges LIKE 'flow_id'")
  if (!flowColumn.length) await pool.query('ALTER TABLE auth_sms_challenges ADD COLUMN flow_id CHAR(32) NULL')
  const server = createServer(createAuthRequestHandler(pool))
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  server.maxRequestsPerSocket = 100
  const cleanupTimer = setInterval(() => { void cleanupExpired(pool).catch((error) => console.error('[auth] cleanup failed:', error.message)) }, 60 * 60_000)
  cleanupTimer.unref()
  server.on('close', () => clearInterval(cleanupTimer))
  server.listen(cfg.port, cfg.host, () => console.log(`[auth] listening on ${cfg.host}:${cfg.port}`))
  return { server, pool }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startAuthServer().catch((error) => { console.error('[auth] startup failed:', error.message); process.exitCode = 1 })
}
