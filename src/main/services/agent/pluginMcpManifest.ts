import { lstat, readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { isAbsolute, relative, resolve, win32 } from 'node:path'
import type { PluginMcpAuthKind, PluginMcpServerDeclaration } from '../../../shared/types'

const MAX_FILE_BYTES = 128 * 1024
const MAX_SERVERS = 8
const SERVER_ID = /^[a-z][a-z0-9._-]{0,63}$/
const ALLOWED_FIELDS = new Set([
  'url', 'transport', 'auth', 'apiKeyHeader', 'oauthClientId', 'oauthScopes'
])

export async function readPluginMcpDeclarations(
  pluginRoot: string,
  mcpPath: string
): Promise<PluginMcpServerDeclaration[]> {
  const root = resolve(pluginRoot)
  const target = resolve(root, mcpPath)
  const fromRoot = relative(root, target)
  if (!mcpPath || isAbsolute(mcpPath) || win32.isAbsolute(mcpPath) ||
      fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('MCP 声明必须位于插件目录内')
  let info
  try { info = await lstat(target) } catch { throw new Error('MCP 声明不是普通文件') }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('MCP 声明不是普通文件')
  if (info.size > MAX_FILE_BYTES) throw new Error('MCP 声明文件过大')
  let document: unknown
  try { document = JSON.parse(await readFile(target, 'utf8')) } catch { throw new Error('MCP 声明不是有效 JSON') }
  validateComplexity(document)
  if (!record(document)) throw new Error('MCP 声明格式无效')
  const wrapped = Object.prototype.hasOwnProperty.call(document, 'mcpServers')
  if (wrapped && Object.keys(document).some((key) => key !== 'mcpServers')) throw new Error('MCP 声明包装格式无效')
  const servers = wrapped ? document.mcpServers : document
  if (!record(servers)) throw new Error('MCP server 列表无效')
  const entries = Object.entries(servers)
  if (!entries.length || entries.length > MAX_SERVERS) throw new Error('MCP server 数量无效')
  return entries.sort(([left], [right]) => left.localeCompare(right)).map(([id, raw]) => parseServer(id, raw))
}

function parseServer(id: string, value: unknown): PluginMcpServerDeclaration {
  if (!SERVER_ID.test(id) || !record(value)) throw new Error('MCP server 定义无效')
  if ('command' in value || 'args' in value || 'env' in value) throw new Error('不支持 stdio MCP 或本地命令')
  if ('headers' in value) throw new Error('MCP 声明不能包含凭据或 headers')
  if (Object.keys(value).some((key) => !ALLOWED_FIELDS.has(key))) throw new Error('MCP server 包含不支持的字段')
  if (value.transport !== undefined && value.transport !== 'streamable-http') throw new Error('MCP 传输方式不受支持')
  const url = parseServerUrl(value.url)
  const auth = value.auth === undefined ? 'none' : value.auth
  if (!['none', 'api-key', 'oauth2'].includes(String(auth))) throw new Error('MCP 认证方式无效')
  const normalized: PluginMcpServerDeclaration = {
    id, url: url.toString(), transport: 'streamable-http', auth: auth as PluginMcpAuthKind
  }
  if (auth === 'api-key') {
    const header = value.apiKeyHeader ?? 'Authorization'
    if (header !== 'Authorization' && header !== 'X-API-Key') throw new Error('API Key header 无效')
    normalized.apiKeyHeader = header
  } else if (value.apiKeyHeader !== undefined) throw new Error('API Key header 与认证方式不匹配')
  if (auth === 'oauth2') {
    if (value.oauthClientId !== undefined) normalized.oauthClientId = text(value.oauthClientId, 'OAuth client ID', 200)
    if (value.oauthScopes !== undefined) normalized.oauthScopes = scopes(value.oauthScopes)
  } else if (value.oauthClientId !== undefined || value.oauthScopes !== undefined) {
    throw new Error('OAuth 字段与认证方式不匹配')
  }
  return normalized
}

function parseServerUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2_048) throw new Error('MCP URL 无效')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('MCP URL 无效') }
  if (url.protocol !== 'https:') throw new Error('MCP 服务必须使用 HTTPS')
  if (url.username || url.password) throw new Error('MCP URL 不能包含凭据')
  if (url.hash) throw new Error('MCP URL 不能包含片段')
  if (isLocalHost(url.hostname)) throw new Error('MCP 服务不能使用本地或私有地址')
  return url
}

function isLocalHost(raw: string): boolean {
  const host = raw.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  const family = isIP(host)
  if (family === 4) {
    const [a, b] = host.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
  }
  return family === 6 && (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb'))
}

function scopes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20 || value.some((item) =>
    typeof item !== 'string' || !item || item.length > 100 || /[\u0000-\u0020\u007f]/.test(item))) throw new Error('OAuth scope 无效')
  return [...new Set(value)].sort()
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error(`${label} 无效`)
  return value.trim()
}

function validateComplexity(value: unknown): void {
  let nodes = 0
  const visit = (item: unknown, depth: number): void => {
    nodes += 1
    if (depth > 12 || nodes > 2_000) throw new Error('MCP 声明结构过于复杂')
    if (Array.isArray(item)) for (const child of item) visit(child, depth + 1)
    else if (record(item)) for (const child of Object.values(item)) visit(child, depth + 1)
  }
  visit(value, 0)
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
