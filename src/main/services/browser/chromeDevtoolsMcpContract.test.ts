import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import { describe, expect, it } from 'vitest'
import { assertOfficialToolContract } from './chromeDevtoolsMcpContract'
import { officialChromeDevtoolsMcpArgs } from './chromeDevtoolsMcpClient'
import pinnedTools from './fixtures/chrome-devtools-mcp-1.7.0-tools.json'

describe('pinned Google Chrome DevTools MCP contract', () => {
  it('rejects absent official tools and changed required parameters before any browser action', () => {
    expect(() => assertOfficialToolContract([])).toThrow('click')
    expect(() => assertOfficialToolContract([{
      name: 'click',
      inputSchema: { properties: { pageId: { type: 'number' }, uid: { type: 'string' } }, required: ['pageId'] }
    }])).toThrow('必填参数已变化: click')
  })

  it('matches the actual tools/list schema of the installed official 1.7.0 server', async () => {
    const require = createRequire(import.meta.url)
    const packageRoot = dirname(require.resolve('chrome-devtools-mcp/package.json'))
    const manifest = require('chrome-devtools-mcp/package.json') as { version: string }
    expect(manifest.version).toBe('1.7.0')
    const entrypoint = join(packageRoot, 'build', 'src', 'bin', 'chrome-devtools-mcp.js')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: officialChromeDevtoolsMcpArgs(entrypoint),
      env: {
        ...getDefaultEnvironment(),
        CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
        CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1'
      },
      stderr: 'ignore'
    })
    const client = new Client(
      { name: 'astryve-contract-test', version: '0.1.0' },
      { versionNegotiation: { mode: 'legacy' } }
    )
    try {
      await client.connect(transport, { timeout: 15_000 })
      const listed = await client.listTools(undefined, { timeout: 10_000 })
      expect(listed.tools.length).toBeGreaterThanOrEqual(24)
      expect(listed.tools.map(({ name, inputSchema }) => ({ name, inputSchema }))
        .sort((a, b) => a.name.localeCompare(b.name))).toEqual(pinnedTools)
      expect(() => assertOfficialToolContract(listed.tools)).not.toThrow()
      expect(() => assertOfficialToolContract(listed.tools.filter((tool) => tool.name !== 'take_screenshot')))
        .toThrow('take_screenshot')
      const drifted = structuredClone(listed.tools)
      const screenshot = drifted.find((tool) => tool.name === 'take_screenshot')
      if (!screenshot?.inputSchema.properties) throw new Error('take_screenshot schema missing from official tools/list')
      screenshot.inputSchema.properties.pageId = { type: 'string' }
      expect(() => assertOfficialToolContract(drifted)).toThrow('take_screenshot.pageId')
    } finally {
      await client.close().catch(() => undefined)
    }
  }, 30_000)
})
