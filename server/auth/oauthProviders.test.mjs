import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exchangeProviderIdentity, providerAuthorizeUrl, providerEnabled } from './oauthProviders.mjs'

const config = {
  qq: { clientId: 'qq-app-id', clientSecret: 'qq-server-secret' },
  wechat: { clientId: 'wx-app-id', clientSecret: 'wx-server-secret' }
}
const callback = 'https://login.example.com/v1/auth/oauth/callback/qq'

test('provider links use fixed Tencent origins and the registered callback', () => {
  const qq = new URL(providerAuthorizeUrl('qq', config, callback, 'random-state'))
  assert.equal(qq.origin, 'https://graph.qq.com')
  assert.equal(qq.searchParams.get('redirect_uri'), callback)
  assert.equal(qq.searchParams.get('state'), 'random-state')
  const wechat = new URL(providerAuthorizeUrl('wechat', config, callback, 'random-state'))
  assert.equal(wechat.origin, 'https://open.weixin.qq.com')
  assert.equal(wechat.searchParams.get('scope'), 'snsapi_login')
  assert.equal(providerEnabled('qq', { qq: { clientId: 'id' } }), false)
  assert.equal(providerEnabled('__proto__', config), false)
})

test('QQ requires the configured client ID from the OpenID response', async () => {
  const seen = []
  const fetchStub = async (url) => {
    seen.push(new URL(url))
    return { ok: true, text: async () => JSON.stringify(seen.length === 1
      ? { access_token: 'valid_qq_token_123' }
      : { client_id: 'qq-app-id', openid: 'openid123456' }) }
  }
  assert.equal(await exchangeProviderIdentity('qq', config, callback, 'oauthcode123', fetchStub), 'openid123456')
  assert.equal(seen[0].origin, 'https://graph.qq.com')
  assert.equal(seen[0].searchParams.get('redirect_uri'), callback)
  assert.equal(seen[1].pathname, '/oauth2.0/me')
  await assert.rejects(exchangeProviderIdentity('qq', config, callback, 'oauthcode123', async (url) => ({
    ok: true, text: async () => JSON.stringify(new URL(url).pathname === '/oauth2.0/token'
      ? { access_token: 'valid_qq_token_123' }
      : { client_id: 'another-app', openid: 'openid123456' })
  })))
})

test('WeChat requires a valid token and successful server-side auth check', async () => {
  const seen = []
  const fetchStub = async (url) => {
    seen.push(new URL(url))
    return { ok: true, text: async () => JSON.stringify(seen.length === 1
      ? { access_token: 'valid_wechat_token_123', openid: 'wxopenid123456' }
      : { errcode: 0, errmsg: 'ok' }) }
  }
  assert.equal(await exchangeProviderIdentity('wechat', config, callback, 'oauthcode123', fetchStub), 'wxopenid123456')
  assert.equal(seen[0].origin, 'https://api.weixin.qq.com')
  assert.equal(seen[1].pathname, '/sns/auth')
})
