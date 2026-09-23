import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  Client,
  type CallToolResult
} from '@modelcontextprotocol/client'
import {
  StdioClientTransport,
  getDefaultEnvironment
} from '@modelcontextprotocol/client/stdio'
import { assertOfficialToolContract, REQUIRED_OFFICIAL_TOOLS } from './chromeDevtoolsMcpContract'

const OFFICIAL_SERVER_VERSION = '1.7.0'
const MAX_RESULT_BYTES = 4 * 1024 * 1024

export interface ChromeDevtoolsMcpResult {
  content: CallToolResult['content']
  structuredContent?: unknown
  isError?: boolean
}

export interface ChromeDevtoolsMcpSession {
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ChromeDevtoolsMcpResult>
  close(): Promise<void>
}

export interface ChromeDevtoolsMcpClientOptions {
  command?: string
  entrypoint?: string
}

/**
 * Starts Google's pinned Chrome DevTools MCP server over the official stdio
 * transport. Raw tools remain private to the trusted BrowserAdapter.
 */
export async function createChromeDevtoolsMcpSession(
  options: ChromeDevtoolsMcpClientOptions = {}
): Promise<ChromeDevtoolsMcpSession> {
  const command = options.command ?? process.execPath
  const entrypoint = options.entrypoint ?? resolveOfficialServerEntrypoint()
  const transport = new StdioClientTransport({
    command,
    args: officialChromeDevtoolsMcpArgs(entrypoint),
    env: {
      ...getDefaultEnvironment(),
      ELECTRON_RUN_AS_NODE: '1',
      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1'
    },
    // No consumer is attached to stderr. Ignoring it avoids retaining a pipe
    // after the SDK has terminated the official child process during shutdown.
    stderr: 'ignore',
    maxBufferSize: MAX_RESULT_BYTES
  })
  const client = new Client(
    { name: 'astryve-browser-gateway', version: '0.1.0' },
    {
      versionNegotiation: { mode: 'legacy' },
      listMaxPages: 4,
      enforceStrictCapabilities: true
    }
  )
  let available = new Map<string, unknown>()
  try {
    await client.connect(transport, { timeout: 15_000 })
    const listed = await client.listTools(undefined, {
      timeout: 10_000,
      cacheMode: 'refresh'
    })
    assertOfficialToolContract(listed.tools)
    available = new Map(listed.tools.map((tool) => [tool.name, tool.inputSchema]))
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }

  let closed = false
  return {
    async callTool(name, args, signal) {
      if (closed) throw new Error('Chrome DevTools MCP 已关闭')
      if (!REQUIRED_OFFICIAL_TOOLS.has(name)) throw new Error('Chrome DevTools MCP 工具不在受信白名单')
      validateArguments(name, args, available.get(name))
      const result = await client.callTool(
        { name, arguments: structuredClone(args) },
        { signal, timeout: 60_000, maxTotalTimeout: 60_000 }
      )
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESULT_BYTES) {
        throw new Error('Chrome DevTools MCP 返回超过大小限制')
      }
      return {
        content: result.content,
        ...(result.structuredContent === undefined
          ? {}
          : { structuredContent: result.structuredContent }),
        ...(result.isError === undefined ? {} : { isError: result.isError })
      }
    },
    async close() {
      if (closed) return
      closed = true
      await client.close().catch(() => undefined)
    }
  }
}

/** Exact flags documented by Google's pinned chrome-devtools-mcp release. */
export function officialChromeDevtoolsMcpArgs(entrypoint: string): string[] {
  return [
    entrypoint,
    '--auto-connect',
    '--experimental-page-id-routing=true',
    '--no-usage-statistics',
    '--no-performance-crux',
    '--redact-network-headers',
    '--category-emulation=false',
    '--category-performance=false',
    '--experimental-structured-content=true'
  ]
}

function resolveOfficialServerEntrypoint(): string {
  const require = createRequire(import.meta.url)
  const packageJson = require.resolve('chrome-devtools-mcp/package.json')
  const packageRoot = dirname(packageJson)
  const entrypoint = join(
    packageRoot,
    'build',
    'src',
    'bin',
    'chrome-devtools-mcp.js'
  )
  // electron-builder places configured unpacked modules beside app.asar.
  return entrypoint.replace(
    `${join('resources', 'app.asar')}`,
    `${join('resources', 'app.asar.unpacked')}`
  )
}

export const CHROME_DEVTOOLS_MCP_PINNED_VERSION = OFFICIAL_SERVER_VERSION

function validateArguments(
  name: string,
  args: Record<string, unknown>,
  schema: unknown
): void {
  if (!record(schema) || !record(schema.properties)) {
    throw new Error(`Chrome DevTools MCP 工具定义无效: ${name}`)
  }
  const properties = schema.properties
  for (const key of Object.keys(args)) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      throw new Error(`Chrome DevTools MCP 参数不在官方 schema: ${name}.${key}`)
    }
  }
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(args, key)) {
        throw new Error(`Chrome DevTools MCP 缺少官方必填参数: ${name}.${key}`)
      }
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
