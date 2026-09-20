import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, win32 } from 'node:path'
import type { PluginComponent, PluginMetadata, PluginPermission } from '../../../shared/types'
import type { OperationKind, ToolInputSchema } from '../../../shared/agent'
import { hasSafeValueShape, isOperationKind } from './validation'

const MAX_MANIFEST_BYTES = 256 * 1024
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const PERMISSIONS = new Set<PluginPermission>([
  'workspace.read', 'workspace.write', 'network', 'process', 'browser.read', 'browser.interact'
])
const EXECUTABLE_ALIASES = ['main', 'entry', 'script', 'scripts', 'worker', 'workers', 'components']

export interface ParsedPluginTool {
  name: string
  description: string
  entry: string
  operation: OperationKind
  parameters: ToolInputSchema
}

export type PluginHookEvent = 'task.created' | 'task.status-changed' | 'tool.completed'
export interface ParsedPluginHook {
  event: PluginHookEvent
  entry: string
  priority: number
  timeoutMs: number
}

export interface ParsedPluginManifest extends Omit<PluginMetadata, 'enabled' | 'status' | 'source' | 'errors'> {
  tools: ParsedPluginTool[]
  hooks: ParsedPluginHook[]
  assetPaths: string[]
  skillsPath?: string
  mcpPath?: string
}

export async function readPluginManifest(root: string): Promise<ParsedPluginManifest> {
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('插件目录无效')
  const nativePath = join(root, 'plugin.json')
  const codexPath = join(root, '.codex-plugin', 'plugin.json')
  const [native, codex] = await Promise.all([isRegularFile(nativePath), isRegularFile(codexPath)])
  if (native && codex) throw new Error('存在多个插件清单')
  if (!native && !codex) throw new Error('未找到插件清单')

  const manifestPath = native ? nativePath : codexPath
  const info = await lstat(manifestPath)
  if (info.size > MAX_MANIFEST_BYTES) throw new Error('插件清单过大')
  let value: unknown
  try { value = JSON.parse(await readFile(manifestPath, 'utf8')) } catch { throw new Error('插件清单不是有效 JSON') }
  if (!isRecord(value)) throw new Error('插件清单格式无效')
  validateComplexity(value)

  const sourceFormat = native ? 'native' : 'codex'
  if (sourceFormat === 'native' && value.schemaVersion !== 1) throw new Error('插件清单版本不受支持')
  const rawId = sourceFormat === 'codex' ? value.name : value.id
  const id = requiredText(rawId, '插件标识', 64).toLowerCase()
  if (!ID_PATTERN.test(id)) throw new Error('插件标识无效')
  const version = optionalText(value.version, '插件版本', 64)
  if (version && !VERSION_PATTERN.test(version)) throw new Error('插件版本无效')
  const interfaceValue = isRecord(value.interface) ? value.interface : undefined
  const name = optionalText(interfaceValue?.displayName, '插件名称', 100) ?? requiredText(value.name, '插件名称', 100)
  const description = optionalText(value.description, '插件说明', 1000) ?? ''
  const author = parseAuthor(value.author)
  const permissions = parsePermissions(value.permissions)
  const capabilities = stringArray(interfaceValue?.capabilities, '插件能力', 32, 64).sort()
  const iconPath = parseIconPath(value.icon)
  const assetPaths = parseAssetPaths(value.assets)
  const components: PluginComponent[] = []
  const tools: ParsedPluginTool[] = []
  const hooks = parseHooks(value.hooks)
  if (typeof value.skills === 'string') components.push('skills')
  if (hooks.length) components.push('hooks')
  if (value.mcp !== undefined || value.mcpServers !== undefined) components.push('mcp')
  if (Array.isArray(value.tools) && value.tools.length) components.push('tools')
  if (!components.length) throw new Error('插件未声明任何可用组件')
  if (sourceFormat === 'native' && EXECUTABLE_ALIASES.some((key) => value[key] !== undefined)) {
    throw new Error('插件包含不受支持的可执行入口')
  }
  for (const field of ['skills', 'mcp', 'mcpServers'] as const) {
    if (typeof value[field] === 'string') assertRelativePluginPath(value[field])
  }
  const mcpPath = typeof value.mcp === 'string' ? value.mcp : typeof value.mcpServers === 'string' ? value.mcpServers : undefined
  if (components.includes('mcp') && !mcpPath) throw new Error('MCP 声明路径无效')
  if (Array.isArray(value.tools)) {
    const names = new Set<string>()
    for (const tool of value.tools) {
      if (!isRecord(tool)) throw new Error('插件工具定义无效')
      const toolName = requiredText(tool.name, '插件工具名称', 64)
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(toolName) || names.has(toolName)) throw new Error('插件工具名称重复或无效')
      names.add(toolName)
    }
    for (const tool of value.tools) {
      if (!isRecord(tool)) throw new Error('插件工具定义无效')
      const toolName = requiredText(tool.name, '插件工具名称', 64)
      if (typeof tool.entry !== 'string') throw new Error('插件工具入口无效')
      assertRelativePluginPath(tool.entry)
      const operation = tool.operation
      if (operation === 'external.call') throw new Error('external.call 是宿主专用操作')
      if (!isOperationKind(operation)) throw new Error('插件工具操作类型无效')
      const parameters = parseToolSchema(tool.parameters)
      tools.push({
        name: toolName,
        description: requiredText(tool.description, '插件工具说明', 500),
        entry: tool.entry,
        operation,
        parameters
      })
    }
  }
  return {
    id, name, version, description, author, sourceFormat, permissions, capabilities, components, tools, hooks, iconPath, assetPaths,
    skillsPath: typeof value.skills === 'string' ? value.skills : undefined,
    mcpPath
  }
}

function parseIconPath(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (!isImageAssetPath(value)) {
    throw new Error('插件图标必须是 assets 目录内的 PNG、JPEG 或 WebP 图片')
  }
  return value
}

function parseAssetPaths(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 32) throw new Error('插件静态资源声明无效')
  if (value.some((path) => !isImageAssetPath(path)) || new Set(value).size !== value.length) {
    throw new Error('插件静态资源声明无效')
  }
  return value as string[]
}

function isImageAssetPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 &&
    /^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(value)
}

function parseHooks(value: unknown): ParsedPluginHook[] {
  if (value === undefined) return []
  if (!isRecord(value)) throw new Error('Hooks 声明无效')
  const allowed = new Set<PluginHookEvent>(['task.created', 'task.status-changed', 'tool.completed'])
  const hooks: ParsedPluginHook[] = []
  for (const [event, declarations] of Object.entries(value)) {
    if (!allowed.has(event as PluginHookEvent)) throw new Error('Hook 事件无效')
    if (!Array.isArray(declarations) || !declarations.length || declarations.length > 16) throw new Error('Hook 声明无效')
    for (const declaration of declarations) {
      if (!isRecord(declaration) || typeof declaration.entry !== 'string') throw new Error('Hook 声明无效')
      if (Object.keys(declaration).some((key) => !['entry', 'priority', 'timeoutMs'].includes(key))) throw new Error('Hook 声明包含不支持字段')
      assertRelativePluginPath(declaration.entry)
      const priority = declaration.priority ?? 0
      const timeoutMs = declaration.timeoutMs ?? 1000
      if (!Number.isSafeInteger(priority) || Number(priority) < -100 || Number(priority) > 100) throw new Error('Hook 优先级无效')
      if (!Number.isSafeInteger(timeoutMs) || Number(timeoutMs) < 50 || Number(timeoutMs) > 5000) throw new Error('Hook 超时无效')
      hooks.push({ event: event as PluginHookEvent, entry: declaration.entry, priority: Number(priority), timeoutMs: Number(timeoutMs) })
      if (hooks.length > 32) throw new Error('Hook 数量超过限制')
    }
  }
  return hooks
}

function parseToolSchema(value: unknown): ToolInputSchema {
  if (!isRecord(value) || !hasSafeValueShape(value) || value.type !== 'object' ||
      !isRecord(value.properties) || value.additionalProperties !== false) {
    throw new Error('插件工具参数必须是封闭对象 schema')
  }
  const properties = value.properties as Record<string, unknown>
  if (value.required !== undefined && (!Array.isArray(value.required) ||
      value.required.some((item) => typeof item !== 'string' || !(item in properties)))) {
    throw new Error('插件工具必填参数无效')
  }
  for (const [name, schema] of Object.entries(properties)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(name) || !isSafePropertySchema(schema, 0)) {
      throw new Error('插件工具参数 schema 无效')
    }
  }
  return structuredClone(value) as unknown as ToolInputSchema
}

function isSafePropertySchema(value: unknown, depth: number): boolean {
  if (!isRecord(value) || depth > 6) return false
  const type = value.type
  if (!['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(String(type))) return false
  if (type === 'array') return value.items !== undefined && isSafePropertySchema(value.items, depth + 1)
  if (type === 'object') {
    if (!isRecord(value.properties) || value.additionalProperties !== false) return false
    return Object.values(value.properties).every((child) => isSafePropertySchema(child, depth + 1))
  }
  return true
}

async function isRegularFile(path: string): Promise<boolean> {
  try { const info = await lstat(path); return info.isFile() && !info.isSymbolicLink() } catch { return false }
}

function assertRelativePluginPath(value: string): void {
  const path = value.trim()
  const normalized = normalize(path)
  if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('\\\\') || isAbsolute(path) || win32.isAbsolute(path) || normalized === '..' || normalized.startsWith(`..${win32.sep}`) || relative('.', normalized).startsWith('..')) {
    throw new Error('插件路径必须位于插件目录内')
  }
}

function validateComplexity(value: unknown): void {
  let nodes = 0
  const visit = (item: unknown, depth: number): void => {
    nodes += 1
    if (depth > 16 || nodes > 4_000) throw new Error('插件清单结构过于复杂')
    if (Array.isArray(item)) for (const child of item) visit(child, depth + 1)
    else if (isRecord(item)) for (const child of Object.values(item)) visit(child, depth + 1)
  }
  visit(value, 0)
}

function parsePermissions(value: unknown): PluginPermission[] {
  if (value === undefined) return []
  const values = stringArray(value, '插件权限', 32, 64)
  if (values.some((item) => !PERMISSIONS.has(item as PluginPermission))) throw new Error('插件权限无效')
  return [...new Set(values as PluginPermission[])].sort()
}

function parseAuthor(value: unknown): string | undefined {
  if (typeof value === 'string') return optionalText(value, '插件作者', 100)
  if (isRecord(value)) return optionalText(value.name, '插件作者', 100)
  return undefined
}

function stringArray(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label}无效`)
  return value.map((item) => requiredText(item, label, maxLength))
}

function requiredText(value: unknown, label: string, max: number): string {
  const text = optionalText(value, label, max)
  if (!text) throw new Error(`${label}无效`)
  return text
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${label}无效`)
  const text = value.trim()
  if (!text || text.length > max || /[\u0000-\u001f]/.test(text)) throw new Error(`${label}无效`)
  return text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
