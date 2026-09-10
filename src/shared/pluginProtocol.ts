export const PLUGIN_PROTOCOL_VERSION = 1 as const
export const PLUGIN_MESSAGE_LIMIT_BYTES = 200 * 1024

export interface PluginWorkerDefinition {
  pluginId: string
  rootPath: string
  tools: Array<{ name: string; entryPath: string }>
}

export interface PluginInvocationContext {
  taskId: string
  workspaceId?: string
}

export type PluginWorkerHostMessage =
  | { type: 'plugin.init'; protocolVersion: 1; plugin: PluginWorkerDefinition }
  | { type: 'plugin.invoke'; protocolVersion: 1; id: string; toolName: string; args: unknown; context: PluginInvocationContext }
  | { type: 'plugin.cancel'; protocolVersion: 1; id: string; reason: string }
  | { type: 'plugin.stop'; protocolVersion: 1; reason: string }

export type PluginWorkerMessage =
  | { type: 'plugin.ready'; protocolVersion: 1; pluginId: string }
  | { type: 'plugin.heartbeat'; protocolVersion: 1; timestamp: number }
  | { type: 'plugin.result'; protocolVersion: 1; id: string; result: unknown }
  | { type: 'plugin.error'; protocolVersion: 1; id: string; code: string; message: string }
  | { type: 'plugin.fatal'; protocolVersion: 1; code: string; message: string }

export function serializedPluginMessageSize(message: unknown): number {
  try {
    const encoded = JSON.stringify(message)
    return encoded === undefined ? Number.POSITIVE_INFINITY : Buffer.byteLength(encoded, 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function isPluginWorkerMessage(value: unknown): value is PluginWorkerMessage {
  if (!isRecord(value) || value.protocolVersion !== PLUGIN_PROTOCOL_VERSION || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'plugin.ready':
      return isSafeText(value.pluginId, 64)
    case 'plugin.heartbeat':
      return typeof value.timestamp === 'number' && Number.isFinite(value.timestamp)
    case 'plugin.result':
      return isCallId(value.id) && Object.prototype.hasOwnProperty.call(value, 'result')
    case 'plugin.error':
      return isCallId(value.id) && isSafeText(value.code, 64) && isSafeText(value.message, 2_000)
    case 'plugin.fatal':
      return isSafeText(value.code, 64) && isSafeText(value.message, 2_000)
    default:
      return false
  }
}

export function isPluginWorkerHostMessage(value: unknown): value is PluginWorkerHostMessage {
  if (!isRecord(value) || value.protocolVersion !== PLUGIN_PROTOCOL_VERSION || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'plugin.init':
      return isPluginWorkerDefinition(value.plugin)
    case 'plugin.invoke':
      return isCallId(value.id) && isToolName(value.toolName) && Object.prototype.hasOwnProperty.call(value, 'args') && isInvocationContext(value.context)
    case 'plugin.cancel':
      return isCallId(value.id) && isSafeText(value.reason, 256)
    case 'plugin.stop':
      return isSafeText(value.reason, 256)
    default:
      return false
  }
}

export function isPluginWorkerDefinition(value: unknown): value is PluginWorkerDefinition {
  return isRecord(value) && isSafeText(value.pluginId, 64) &&
    typeof value.rootPath === 'string' && value.rootPath.length > 0 && value.rootPath.length <= 4_096 &&
    Array.isArray(value.tools) && value.tools.length > 0 && value.tools.length <= 128 &&
    value.tools.every((tool) => isRecord(tool) && isToolName(tool.name) &&
      typeof tool.entryPath === 'string' && tool.entryPath.length > 0 && tool.entryPath.length <= 1_024) &&
    new Set(value.tools.map((tool) => isRecord(tool) ? tool.name : undefined)).size === value.tools.length
}

function isInvocationContext(value: unknown): value is PluginInvocationContext {
  return isRecord(value) && isSafeText(value.taskId, 128) &&
    (value.workspaceId === undefined || isSafeText(value.workspaceId, 128))
}

function isToolName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value)
}

function isCallId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{16,64}$/i.test(value)
}

function isSafeText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
