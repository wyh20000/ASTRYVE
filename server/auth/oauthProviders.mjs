const QQ_ORIGIN = 'https://graph.qq.com'
const WECHAT_OPEN = 'https://open.weixin.qq.com'
const WECHAT_API = 'https://api.weixin.qq.com'
const opaque = (value, min = 6, max = 2048) =>
  typeof value === 'string' && value.length >= min && value.length <= max && !/[\x00-\x20\x7f]/.test(value)

export function providerEnabled(provider, config) {
  if (provider !== 'qq' && provider !== 'wechat') return false
  const app = config[provider]
  return Boolean(app?.clientId && app?.clientSecret)
}

export function providerAuthorizeUrl(provider, config, callbackUrl, state) {
  if (!providerEnabled(provider, config)) throw new Error('登录方式未配置')
  const app = config[provider]
  const url = new URL(provider === 'qq' ? '/oauth2.0/authorize' : '/connect/qrconnect', provider === 'qq' ? QQ_ORIGIN : WECHAT_OPEN)
  if (provider === 'qq') {
    url.search = new URLSearchParams({ response_type: 'code', client_id: app.clientId, redirect_uri: callbackUrl, state }).toString()
  } else if (provider === 'wechat') {
    url.search = new URLSearchParams({ appid: app.clientId, redirect_uri: callbackUrl, response_type: 'code', scope: 'snsapi_login', state }).toString()
    url.hash = 'wechat_redirect'
  } else throw new Error('未知登录方式')
  return url.toString()
}

async function providerJson(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('第三方认证服务不可用')
  const raw = await response.text()
  if (raw.length > 16_384) throw new Error('第三方认证响应过大')
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('第三方认证响应无效')
  return parsed
}

export async function exchangeProviderIdentity(provider, config, callbackUrl, code, fetchImpl = fetch) {
  if (!providerEnabled(provider, config) || !opaque(code, 6, 512)) {
    throw new Error('第三方认证响应无效')
  }
  const app = config[provider]
  if (provider === 'qq') {
    const tokenUrl = new URL('/oauth2.0/token', QQ_ORIGIN)
    tokenUrl.search = new URLSearchParams({ grant_type: 'authorization_code', client_id: app.clientId,
      client_secret: app.clientSecret, code, redirect_uri: callbackUrl, fmt: 'json' }).toString()
    const token = await providerJson(tokenUrl, fetchImpl)
    if (!opaque(token.access_token, 8)) throw new Error('QQ 授权失败')
    const meUrl = new URL('/oauth2.0/me', QQ_ORIGIN)
    meUrl.search = new URLSearchParams({ access_token: token.access_token, fmt: 'json' }).toString()
    const identity = await providerJson(meUrl, fetchImpl)
    if (identity.client_id !== app.clientId || !opaque(identity.openid, 8, 128)) {
      throw new Error('QQ 账号验证失败')
    }
    return identity.openid
  }
  if (provider === 'wechat') {
    const tokenUrl = new URL('/sns/oauth2/access_token', WECHAT_API)
    tokenUrl.search = new URLSearchParams({ appid: app.clientId, secret: app.clientSecret, code, grant_type: 'authorization_code' }).toString()
    const token = await providerJson(tokenUrl, fetchImpl)
    if (!opaque(token.openid, 8, 128) || !opaque(token.access_token, 8)) throw new Error('微信授权失败')
    const authUrl = new URL('/sns/auth', WECHAT_API)
    authUrl.search = new URLSearchParams({ access_token: token.access_token, openid: token.openid }).toString()
    const verified = await providerJson(authUrl, fetchImpl)
    if (verified.errcode !== 0) throw new Error('微信账号验证失败')
    return token.openid
  }
  throw new Error('未知登录方式')
}
