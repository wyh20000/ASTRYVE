import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import {
  Client, StreamableHTTPClientTransport, type CallToolResult, type FetchLike
} from '@modelcontextprotocol/client'
import type { PluginMcpServerDeclaration } from '../../../shared/types'

const MAX_TOOLS = 64
const MAX_TOOLS_BYTES = 128 * 1024
const MAX_RESULT_BYTES = 200 * 1024
const MAX_SCHEMA_DEPTH = 12
const MAX_SCHEMA_NODES = 2_000

export type PluginMcpErrorCode =
  | 'MCP_NETWORK_BLOCKED' | 'MCP_UNAUTHORIZED' | 'MCP_FORBIDDEN' | 'MCP_CONNECT_FAILED'
  | 'MCP_TOOLS_INVALID' | 'MCP_CALL_FAILED' | 'MCP_RESULT_TOO_LARGE' | 'MCP_ABORTED'

export class PluginMcpError extends Error {
  constructor(readonly code: PluginMcpErrorCode, message: string) { super(message); this.name = 'PluginMcpError' }
}

export interface PluginMcpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface PluginMcpClient {
  connect(signal: AbortSignal): Promise<void>
  listTools(signal: AbortSignal): Promise<PluginMcpTool[]>
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
  close(): Promise<void>
}

export interface PluginMcpClientDependencies {
  fetch?: typeof fetch
  resolveHostname?: (hostname: string) => Promise<string[]>
  getCredential?: () => Promise<string | undefined>
  connectTimeoutMs?: number
  listTimeoutMs?: number
  callTimeoutMs?: number
}

export function createPluginMcpClient(
  declaration: PluginMcpServerDeclaration,
  dependencies: PluginMcpClientDependencies = {}
): PluginMcpClient {
  const endpoint = new URL(declaration.url)
  const baseFetch = dependencies.fetch ?? fetch
  const resolveHostname = dependencies.resolveHostname ?? resolvePublicAddresses
  const guardedFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const requested = new URL(input instanceof Request ? input.url : input.toString())
    if (requested.origin !== endpoint.origin || requested.protocol !== 'https:') {
      throw new PluginMcpError('MCP_NETWORK_BLOCKED', 'MCP 请求来源发生变化')
    }
    const addresses = await resolveHostname(requested.hostname)
    if (!addresses.length || addresses.some(isPrivateAddress)) {
      throw new PluginMcpError('MCP_NETWORK_BLOCKED', 'MCP 域名解析到本地或私有地址')
    }
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
    if (declaration.auth !== 'none') {
      const credential = await dependencies.getCredential?.()
      if (!credential) throw new PluginMcpError('MCP_UNAUTHORIZED', 'MCP 凭据不可用')
      const header = declaration.apiKeyHeader ?? 'Authorization'
      headers.set(header, header === 'Authorization' && !/^Bearer\s/i.test(credential) ? `Bearer ${credential}` : credential)
    }
    const response = await baseFetch(input, { ...init, headers, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      throw new PluginMcpError('MCP_NETWORK_BLOCKED', 'MCP 请求不允许重定向')
    }
    return response
  }) as FetchLike
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: guardedFetch,
    onInsufficientScope: 'throw',
    reconnectionOptions: { initialReconnectionDelay: 500, maxReconnectionDelay: 2_000, reconnectionDelayGrowFactor: 1.5, maxRetries: 0 }
  })
  const sdk = new Client({ name: 'ai-agent-plugin-host', version: '0.1.0' }, {
    versionNegotiation: { mode: 'legacy' }, listMaxPages: 8, enforceStrictCapabilities: true
  })
  let connected = false

  return {
    async connect(signal) {
      try {
        await sdk.connect(transport, { signal, timeout: dependencies.connectTimeoutMs ?? 15_000 })
        connected = true
      } catch (error) { throw normalizeError(error, 'MCP_CONNECT_FAILED') }
    },
    async listTools(signal) {
      assertConnected(connected)
      try {
        const result = await sdk.listTools(undefined, {
          signal, timeout: dependencies.listTimeoutMs ?? 10_000, cacheMode: 'refresh'
        })
        return normalizeTools(result.tools)
      } catch (error) {
        if (error instanceof PluginMcpError) throw error
        throw normalizeError(error, 'MCP_TOOLS_INVALID')
      }
    },
    async callTool(name, args, signal) {
      assertConnected(connected)
      if (!validToolName(name) || !plainRecord(args)) throw new PluginMcpError('MCP_CALL_FAILED', 'MCP 工具调用参数无效')
      try {
        const result = await sdk.callTool({ name, arguments: args }, {
          signal, timeout: dependencies.callTimeoutMs ?? 60_000, maxTotalTimeout: dependencies.callTimeoutMs ?? 60_000
        })
        return normalizeResult(result)
      } catch (error) {
        if (error instanceof PluginMcpError) throw error
        throw normalizeError(error, 'MCP_CALL_FAILED')
      }
    },
    async close() {
      connected = false
      await sdk.close().catch(() => undefined)
    }
  }
}

function normalizeTools(tools: unknown[]): PluginMcpTool[] {
  if (tools.length > MAX_TOOLS) throw new PluginMcpError('MCP_TOOLS_INVALID', 'MCP 工具数量超限')
  if (serializedBytes(tools) > MAX_TOOLS_BYTES) throw new PluginMcpError('MCP_TOOLS_INVALID', 'MCP 工具目录过大')
  const names = new Set<string>()
  return tools.map((raw) => {
    if (!plainRecord(raw) || typeof raw.name !== 'string' || !validToolName(raw.name) || names.has(raw.name) ||
        (raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 4_096))) {
      throw new PluginMcpError('MCP_TOOLS_INVALID', 'MCP 工具定义无效或重名')
    }
    names.add(raw.name)
    const inputSchema = normalizeSchema(raw.inputSchema)
    return { name: raw.name, ...(raw.description === undefined ? {} : { description: raw.description }), inputSchema }
  })
}

function normalizeSchema(value: unknown): Record<string, unknown> {
  if (!plainRecord(value) || value.type !== 'object' || value.additionalProperties !== false ||
      (value.properties !== undefined && !plainRecord(value.properties))) {
    throw new PluginMcpError('MCP_TOOLS_INVALID', 'MCP 工具 schema 必须是封闭对象')
  }
  validateJson(value, MAX_SCHEMA_DEPTH, MAX_SCHEMA_NODES)
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function normalizeResult(value: CallToolResult): unknown {
  const normalized = {
    content: value.content,
    ...(value.structuredContent === undefined ? {} : { structuredContent: value.structuredContent }),
    ...(value.isError === undefined ? {} : { isError: value.isError })
  }
  let size: number
  try { size = serializedBytes(normalized) } catch { throw new PluginMcpError('MCP_CALL_FAILED', 'MCP 工具结果无效') }
  if (size > MAX_RESULT_BYTES) throw new PluginMcpError('MCP_RESULT_TOO_LARGE', 'MCP 工具结果超过 200 KiB')
  validateJson(normalized, 20, 20_000)
  return JSON.parse(JSON.stringify(normalized)) as unknown
}

function validateJson(value: unknown, maxDepth: number, maxNodes: number): void {
  let nodes = 0
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > maxNodes || depth > maxDepth) throw new PluginMcpError('MCP_TOOLS_INVALID', 'MCP 数据结构过于复杂')
    if (item === null || typeof item === 'boolean') return
    if (typeof item === 'string') { if (item.length > 64 * 1024) throw new PluginMcpError('MCP_TOOLS_INVALID', 'MCP 字符串过长'); return }
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw new PluginMcpError('MCP_TOOLS_INVALID', 'MCP 数值无效'); return }
    if (Array.isArray(item)) { for (const child of item) visit(child, depth + 1); return }
    if (plainRecord(item)) { for (const [key, child] of Object.entries(item)) { visit(key, depth + 1); visit(child, depth + 1) }; return }
    throw new PluginMcpError('MCP_TOOLS_INVALID', 'MCP 数据不是 JSON')
  }
  visit(value, 0)
}

function normalizeError(error: unknown, fallback: PluginMcpErrorCode): PluginMcpError {
  if (error instanceof PluginMcpError) return error
  if (error instanceof DOMException && error.name === 'AbortError') return new PluginMcpError('MCP_ABORTED', 'MCP 请求已取消')
  const message = error instanceof Error ? error.message : ''
  if (/\b401\b|unauthoriz/i.test(message)) return new PluginMcpError('MCP_UNAUTHORIZED', 'MCP 连接需要授权')
  if (/\b403\b|forbidden|insufficient.scope/i.test(message)) return new PluginMcpError('MCP_FORBIDDEN', 'MCP 连接权限不足')
  return new PluginMcpError(fallback, fallback === 'MCP_CONNECT_FAILED' ? 'MCP 连接失败' : 'MCP 工具调用失败')
}

async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((item) => item.address)
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113) || a >= 224
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase()
    const first = Number.parseInt(lower.split(':')[0] || '0', 16)
    return first < 0x2000 || first > 0x3fff || lower.startsWith('2001:db8:')
  }
  return true
}

function assertConnected(value: boolean): void {
  if (!value) throw new PluginMcpError('MCP_CONNECT_FAILED', 'MCP 客户端尚未连接')
}
function validToolName(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) }
function serializedBytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8') }
function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
