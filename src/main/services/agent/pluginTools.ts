import type { OperationKind, ToolDefinition, ToolInputSchema, ToolResult } from '../../../shared/agent'
import type { PluginPermission } from '../../../shared/types'
import { hasSafeValueShape } from './validation'
import type { ParsedPluginManifest, ParsedPluginTool } from './pluginManifest'

export interface PluginToolWorker {
  invoke(toolName: string, args: unknown, context: { taskId: string; workspaceId: string }, signal?: AbortSignal): Promise<unknown>
}

const PERMISSION_BY_OPERATION: Record<OperationKind, PluginPermission> = {
  'fs.read': 'workspace.read', 'fs.search': 'workspace.read',
  'fs.patch': 'workspace.write', 'fs.apply-host': 'workspace.write',
  'process.run': 'process', 'process.start': 'process', 'process.stop': 'process',
  'network.enable': 'network', 'git.read': 'workspace.read', 'git.write': 'workspace.write',
  'browser.read': 'browser.read', 'browser.interact': 'browser.interact'
}

export function createPluginTools(
  plugin: ParsedPluginManifest,
  worker: PluginToolWorker,
  lifecycle: {
    succeeded?: () => void
    failed?: (error: unknown, context: Parameters<ToolDefinition['execute']>[1], reasonCode: string) => void
  } = {}
): ToolDefinition[] {
  return plugin.tools.map((tool) => {
    const needed = PERMISSION_BY_OPERATION[tool.operation]
    if (!plugin.permissions.includes(needed)) {
      throw new Error(`插件工具 ${tool.name} 未声明 ${needed} 权限`)
    }
    assertOperationTargetSchema(tool)
    const parameters = structuredClone(tool.parameters)
    return {
      name: `plugin.${plugin.id}.${tool.name}`,
      plugin: { id: plugin.id, version: plugin.version },
      operation: tool.operation,
      description: tool.description,
      parameters,
      validateArgs: (input: unknown): input is unknown => validateSchema(input, parameters),
      execute: async (input, context): Promise<ToolResult<unknown>> => {
        try {
          const value = await worker.invoke(tool.name, input, {
            taskId: context.taskId, workspaceId: context.workspace.id
          }, context.signal)
          lifecycle.succeeded?.()
          return { ok: true, value }
        } catch (error) {
          const code = pluginErrorCode(error)
          lifecycle.failed?.(error, context, code)
          return { ok: false, error: {
            code,
            message: '插件工具执行失败或已停止'
          } }
        }
      }
    }
  })
}

function assertOperationTargetSchema(tool: ParsedPluginTool): void {
  if (tool.operation === 'browser.read' || tool.operation === 'browser.interact') {
    throw new Error(`插件工具 ${tool.name} 不能直接声明浏览器操作；必须使用 Browser Gateway`)
  }
  const properties = tool.parameters.properties
  const required = new Set(tool.parameters.required ?? [])
  const requireFields = (...fields: string[]): void => {
    if (fields.some((field) => !(field in properties) || !required.has(field))) {
      throw new Error(`插件工具 ${tool.name} 缺少 ${tool.operation} 的目标参数`)
    }
  }
  if (tool.operation === 'process.run' || tool.operation === 'process.start') requireFields('executable', 'args')
  else if (tool.operation === 'process.stop') requireFields('serviceId')
  else if (tool.operation === 'network.enable') requireFields('url', 'scope')
  else if (tool.operation === 'fs.apply-host') requireFields('paths', 'patchHash')
  else if (tool.operation === 'git.read' || tool.operation === 'git.write') requireFields('action')
}

function pluginErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/PLUGIN_(?:STARTUP|WORKER_START|WORKER_ERROR|ROOT_INVALID|DEFINITION_INVALID)/.test(message)) return 'PLUGIN_START_FAILED'
  if (message.includes('TIMEOUT')) return 'PLUGIN_TIMEOUT'
  if (message.includes('CANCELLED') || message.includes('STOPPED')) return 'PLUGIN_CANCELLED'
  return 'PLUGIN_EXECUTION_FAILED'
}

function validateSchema(value: unknown, schema: ToolInputSchema | Record<string, unknown>): boolean {
  if (!hasSafeValueShape(value) || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const object = value as Record<string, unknown>
  const properties = schema.properties as Record<string, Record<string, unknown>>
  const required = Array.isArray(schema.required) ? schema.required : []
  if (required.some((key) => !(key in object))) return false
  if (Object.keys(object).some((key) => !(key in properties))) return false
  return Object.entries(object).every(([key, child]) => validateProperty(child, properties[key]))
}

function validateProperty(value: unknown, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) return false
  switch (schema.type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return Number.isSafeInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'array': return Array.isArray(value) && value.every((item) => validateProperty(item, schema.items as Record<string, unknown>))
    case 'object': return validateSchema(value, schema)
    default: return false
  }
}
