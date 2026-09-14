import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { LoopbackOAuthReceiver, authorizeMcpConnection, createPkceRequest, discoverOAuth } from './pluginOAuth'

const metadataFetch = (overrides: Record<string, unknown> = {}): typeof fetch => vi.fn(async (input) => {
  const url = String(input)
  if (url.includes('oauth-protected-resource')) {
    return Response.json({
      resource: 'https://mcp.example.com/mcp', authorization_servers: ['https://auth.example.com']
    })
  }
  return Response.json({
    issuer: 'https://auth.example.com',
    authorization_endpoint: 'https://auth.example.com/authorize',
    token_endpoint: 'https://auth.example.com/token',
    code_challenge_methods_supported: ['S256'],
    ...overrides
  })
}) as typeof fetch

describe('MCP OAuth', () => {
  const publicDns = async (): Promise<string[]> => ['93.184.216.34']
  it('creates a standards-shaped S256 PKCE request', () => {
    const request = createPkceRequest(Buffer.alloc(32, 7))
    expect(request.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(request.challengeMethod).toBe('S256')
    expect(request.challenge).toBe(createHash('sha256').update(request.verifier).digest('base64url'))
  })

  it('strictly validates protected-resource and authorization-server metadata', async () => {
    const resource = new URL('https://mcp.example.com/mcp')
    await expect(discoverOAuth(metadataFetch(), resource, undefined, publicDns)).resolves.toMatchObject({
      issuer: 'https://auth.example.com', tokenEndpoint: 'https://auth.example.com/token'
    })
    await expect(discoverOAuth(metadataFetch({ code_challenge_methods_supported: ['plain'] }), resource, undefined, publicDns))
      .rejects.toThrow('PKCE S256')
    await expect(discoverOAuth(metadataFetch({ issuer: 'https://other.example.com' }), resource, undefined, publicDns))
      .rejects.toThrow('issuer')
  })

  it('accepts one exact callback and closes the loopback listener', async () => {
    const receiver = await LoopbackOAuthReceiver.open({ state: 'state-1', timeoutMs: 5_000 })
    expect(new URL(receiver.redirectUri).hostname).toBe('127.0.0.1')
    expect((await fetch(`${receiver.redirectUri}?code=bad&state=wrong`)).status).toBe(400)
    expect((await fetch(`${receiver.redirectUri}?code=code-1&state=state-1`)).status).toBe(200)
    await expect(receiver.result).resolves.toEqual({ code: 'code-1' })
    await expect(fetch(receiver.redirectUri)).rejects.toThrow()
  })

  it('opens the system browser, exchanges with the verifier and persists tokens without returning them', async () => {
    const opened: string[] = []
    const saved: Array<[string, string, string]> = []
    let authorizeUrl = ''
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('oauth-protected-resource') || url.includes('oauth-authorization-server')) {
        return metadataFetch()(input, init)
      }
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('granted-code')
      expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      return Response.json({ access_token: 'access-secret', refresh_token: 'refresh-secret', token_type: 'Bearer', expires_in: 3600 })
    }) as typeof fetch
    const result = await authorizeMcpConnection({
      connectionId: '11111111-1111-4111-8111-111111111111',
      resourceUrl: 'https://mcp.example.com/mcp', clientId: 'desktop-client', fetch: fetcher,
      openExternal: async (url) => {
        opened.push(url); authorizeUrl = url
        const parsed = new URL(url)
        const redirect = parsed.searchParams.get('redirect_uri')!
        await fetch(`${redirect}?code=granted-code&state=${parsed.searchParams.get('state')}`)
      },
      resolveHostname: publicDns,
      vault: { set: async (id, kind, value) => { saved.push([id, kind, value]) } }
    })
    expect(opened).toEqual([authorizeUrl])
    expect(saved).toEqual([
      ['11111111-1111-4111-8111-111111111111', 'access-token', 'access-secret'],
      ['11111111-1111-4111-8111-111111111111', 'refresh-token', 'refresh-secret']
    ])
    expect(result).toMatchObject({ connected: true })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
