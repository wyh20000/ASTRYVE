import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPluginMcpDeclarations } from './pluginMcpManifest'

async function fixture(document: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-mcp-'))
  await writeFile(join(root, 'mcp.json'), JSON.stringify(document))
  return root
}

describe('plugin MCP manifest', () => {
  it('normalizes wrapped and direct HTTPS Streamable HTTP server maps', async () => {
    const wrapped = await fixture({ mcpServers: {
      oauth: {
        url: 'https://api.example.com/mcp', transport: 'streamable-http', auth: 'oauth2',
        oauthClientId: 'desktop-client', oauthScopes: ['files.read', 'profile']
      }
    } })
    const direct = await fixture({ api: {
      url: 'https://tools.example.com/mcp', auth: 'api-key', apiKeyHeader: 'X-API-Key'
    } })

    await expect(readPluginMcpDeclarations(wrapped, './mcp.json')).resolves.toEqual([{
      id: 'oauth', url: 'https://api.example.com/mcp', transport: 'streamable-http', auth: 'oauth2',
      oauthClientId: 'desktop-client', oauthScopes: ['files.read', 'profile']
    }])
    await expect(readPluginMcpDeclarations(direct, './mcp.json')).resolves.toEqual([{
      id: 'api', url: 'https://tools.example.com/mcp', transport: 'streamable-http', auth: 'api-key',
      apiKeyHeader: 'X-API-Key'
    }])
  })

  it.each([
    [{ command: 'node', args: ['server.js'] }, 'stdio'],
    [{ url: 'http://api.example.com/mcp' }, 'HTTPS'],
    [{ url: 'https://user:secret@api.example.com/mcp' }, '凭据'],
    [{ url: 'https://api.example.com/mcp#fragment' }, '片段'],
    [{ url: 'https://127.0.0.1/mcp' }, '本地'],
    [{ url: 'https://api.example.com/mcp', headers: { Authorization: 'secret' } }, '凭据'],
    [{ url: 'https://api.example.com/mcp', transport: 'sse' }, '传输'],
    [{ url: 'https://api.example.com/mcp', auth: 'oauth2', oauthScopes: Array(21).fill('scope') }, 'scope']
  ])('rejects an unsafe MCP declaration %#', async (server, message) => {
    const root = await fixture({ mcpServers: { unsafe: server } })
    await expect(readPluginMcpDeclarations(root, './mcp.json')).rejects.toThrow(message)
  })

  it('rejects more than eight servers and oversized documents', async () => {
    const many = await fixture(Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
      `server${index}`, { url: `https://server${index}.example.com/mcp` }
    ])))
    const large = await mkdtemp(join(tmpdir(), 'plugin-mcp-large-'))
    await writeFile(join(large, 'mcp.json'), JSON.stringify({ api: { url: 'https://api.example.com/mcp', padding: 'x'.repeat(129 * 1024) } }))

    await expect(readPluginMcpDeclarations(many, './mcp.json')).rejects.toThrow('数量')
    await expect(readPluginMcpDeclarations(large, './mcp.json')).rejects.toThrow('过大')
  })

  it('rejects MCP files outside the plugin and symbolic links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-mcp-path-'))
    const outside = join(root, '..', `outside-${Date.now()}.json`)
    await writeFile(outside, '{}')
    await expect(readPluginMcpDeclarations(root, '../outside.json')).rejects.toThrow('插件目录')

    const target = join(root, 'target.json')
    await writeFile(target, '{}')
    try {
      await symlink(target, join(root, 'mcp.json'))
      await expect(readPluginMcpDeclarations(root, './mcp.json')).rejects.toThrow('普通文件')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    }
  })

  it('rejects an MCP directory even when it has the expected name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-mcp-directory-'))
    await mkdir(join(root, 'mcp.json'))
    await expect(readPluginMcpDeclarations(root, './mcp.json')).rejects.toThrow('普通文件')
  })
})
