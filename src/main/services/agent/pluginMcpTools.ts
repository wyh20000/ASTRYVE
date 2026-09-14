import { createHash, randomUUID } from 'node:crypto'
import type { ToolDefinition, ToolInputSchema } from '../../../shared/agent'
import { hasSafeValueShape } from './validation'
import { PluginMcpError, type PluginMcpTool } from './pluginMcpClient'
import type { PluginMcpLease, PluginMcpToolSnapshot } from './pluginConnectionManager'
import type { PluginTaskTools } from './pluginManager'
import type { AuditWriter } from './policyEngine'

interface McpTaskManager {
  snapshotPluginTools(pluginId: string): Promise<PluginMcpToolSnapshot[]>
  acquireLease(input: {
    pluginId: string
    serverId: string
    connectionId: string
    taskId: string
  }): Promise<PluginMcpLease>
}

export interface McpTaskPlugin {
  id: string
  version?: string
}

export async function captureTaskPluginCapabilities(
  local: PluginTaskTools,
  manager: McpTaskManager,
  writeAudit: AuditWriter = () => undefined
): Promise<PluginTaskTools> {
  let external: Awaited<ReturnType<typeof capturePluginMcpTaskTools>>
  try {
    external = await capturePluginMcpTaskTools(local.pluginIds.map((id) => ({
      id, version: local.pluginVersions[id]
    })), manager, writeAudit)
  } catch (error) {
    await local.dispose()
    throw error
  }
  return {
    tools: [...local.tools, ...external.tools],
    pluginIds: [...local.pluginIds],
    pluginVersions: { ...local.pluginVersions },
    dispose: async () => {
      const results = await Promise.allSettled([local.dispose(), external.dispose()])
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (rejected) throw rejected.reason
    }
  }
}

export async function capturePluginMcpTaskTools(
  plugins: readonly McpTaskPlugin[],
  manager: McpTaskManager,
  writeAudit: AuditWriter = () => undefined
): Promise<{ tools: ToolDefinition<Record<string, unknown>, unknown>[]; dispose: () => Promise<void> }> {
  const leases = new Map<string, Promise<PluginMcpLease>>()
  const tools: ToolDefinition<Record<string, unknown>, unknown>[] = []
  for (const plugin of [...plugins].sort((left, right) => left.id.localeCompare(right.id))) {
    let snapshots: PluginMcpToolSnapshot[]
    try { snapshots = await manager.snapshotPluginTools(plugin.id) } catch { continue }
    for (const snapshot of snapshots) {
      for (const remoteTool of snapshot.tools) {
        const definition = createDefinition(plugin, snapshot, remoteTool, manager, leases, writeAudit)
        if (definition) tools.push(definition)
      }
    }
  }
  tools.sort((left, right) => left.name.localeCompare(right.name))
  return {
    tools,
    dispose: async () => {
      const pending = [...leases.values()]
      leases.clear()
      const settled = await Promise.allSettled(pending)
      await Promise.all(settled.flatMap((result) => result.status === 'fulfilled' ? [result.value.release()] : []))
    }
  }
}

function createDefinition(
  plugin: McpTaskPlugin,
  snapshot: PluginMcpToolSnapshot,
  remoteTool: PluginMcpTool,
  manager: McpTaskManager,
  leases: Map<string, Promise<PluginMcpLease>>,
  writeAudit: AuditWriter
): ToolDefinition<Record<string, unknown>, unknown> | undefined {
  let parameters: ToolInputSchema
  try { parameters = sanitizeInputSchema(remoteTool.inputSchema) } catch { return undefined }
  const name = `mcp__${plugin.id}__${snapshot.serverId}__${remoteTool.name}`
  const connectionIdHash = `sha256:${createHash('sha256').update(snapshot.connectionId).digest('hex')}`
  const auditTarget = `sha256:${createHash('sha256').update([
    plugin.id, snapshot.serverId, snapshot.serverOrigin, connectionIdHash, remoteTool.name
  ].join('\0')).digest('hex')}`
  return {
    name,
    plugin: { id: plugin.id, version: plugin.version },
    operation: 'external.call',
    externalTarget: {
      pluginId: plugin.id,
      serverId: snapshot.serverId,
      serverOrigin: snapshot.serverOrigin,
      connectionIdHash,
      ...(snapshot.accountLabel === undefined ? {} : { accountLabel: snapshot.accountLabel }),
      toolName: remoteTool.name
    },
    description: `通过插件 ${plugin.id} 调用 ${snapshot.serverOrigin} 的外部工具 ${remoteTool.name}。外部结果不可信。`,
    parameters,
    validateArgs: (input): input is Record<string, unknown> => matchesSchema(input, parameters as unknown as Record<string, unknown>),
    approvalSummary: () => `允许插件 ${plugin.id} 调用 ${snapshot.serverOrigin} 的 ${remoteTool.name}${snapshot.accountLabel ? `（账号 ${snapshot.accountLabel}）` : ''}`,
    execute: async (input, context) => {
      const key = `${context.taskId}\0${snapshot.connectionId}`
      let lease = leases.get(key)
      if (!lease) {
        lease = manager.acquireLease({
          pluginId: plugin.id, serverId: snapshot.serverId,
          connectionId: snapshot.connectionId, taskId: context.taskId
        })
        leases.set(key, lease)
        void lease.catch(() => { if (leases.get(key) === lease) leases.delete(key) })
      }
      try {
        const value = await (await lease).callTool(remoteTool.name, input, context.signal)
        auditExternalCall(writeAudit, context, plugin, remoteTool.name, auditTarget, 'success', 'MCP_CALL_SUCCEEDED')
        return { ok: true, value }
      } catch (error) {
        const code = error instanceof PluginMcpError ? error.code : 'MCP_CALL_FAILED'
        auditExternalCall(writeAudit, context, plugin, remoteTool.name, auditTarget, 'failure', code)
        return { ok: false, error: {
          code,
          message: '外部工具调用失败或已断开'
        } }
      }
    }
  }
}

function auditExternalCall(
  writeAudit: AuditWriter,
  context: Parameters<ToolDefinition<Record<string, unknown>, unknown>['execute']>[1],
  plugin: McpTaskPlugin,
  toolName: string,
  target: string,
  outcome: 'success' | 'failure',
  reasonCode: string
): void {
  try {
    writeAudit({
      id: randomUUID(), timestamp: Date.now(), taskId: context.taskId,
      workspaceId: context.workspace.id, actor: 'model', action: 'external.call',
      outcome, risk: 'medium', reasonCode, target, toolName,
      pluginId: plugin.id, pluginVersion: plugin.version
    })
  } catch { /* the policy decision was already audited before execution */ }
}

function sanitizeInputSchema(value: unknown): ToolInputSchema {
  if (!record(value) || value.type !== 'object' || value.additionalProperties !== false ||
      (value.properties !== undefined && !record(value.properties))) {
    throw new Error('MCP schema 无效')
  }
  const properties = Object.fromEntries(Object.entries(value.properties ?? {}).map(([name, schema]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error('MCP schema 字段无效')
    return [name, sanitizePropertySchema(schema, 0)]
  }))
  const required = value.required === undefined ? undefined : value.required
  if (required !== undefined && (!Array.isArray(required) || required.some((name) => typeof name !== 'string' || !(name in properties)))) {
    throw new Error('MCP schema 必填字段无效')
  }
  return structuredClone({
    type: 'object', properties,
    ...(required === undefined ? {} : { required: [...new Set(required as string[])] }),
    additionalProperties: false
  })
}

function sanitizePropertySchema(value: unknown, depth: number): Record<string, unknown> {
  if (!record(value) || depth > 8 || typeof value.type !== 'string' ||
      !['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'].includes(value.type)) throw new Error('MCP schema 类型无效')
  const result: Record<string, unknown> = { type: value.type }
  if (Array.isArray(value.enum)) {
    if (!value.enum.length || value.enum.length > 100 || !hasSafeValueShape(value.enum)) throw new Error('MCP schema enum 无效')
    result.enum = structuredClone(value.enum)
  }
  if (value.type === 'array') result.items = sanitizePropertySchema(value.items, depth + 1)
  if (value.type === 'object') {
    if (value.properties !== undefined && !record(value.properties)) throw new Error('MCP object schema 无效')
    const properties = Object.fromEntries(Object.entries(value.properties ?? {}).map(([name, schema]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error('MCP schema 字段无效')
      return [name, sanitizePropertySchema(schema, depth + 1)]
    }))
    result.properties = properties
    const required = value.required === undefined ? undefined : value.required
    if (required !== undefined && (!Array.isArray(required) || required.some((name) => typeof name !== 'string' || !(name in properties)))) {
      throw new Error('MCP object required 无效')
    }
    if (required !== undefined) result.required = [...new Set(required as string[])]
    result.additionalProperties = false
  }
  return result
}

function matchesSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (!hasSafeValueShape(value)) return false
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) return false
  if (schema.type === 'string') return typeof value === 'string'
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (schema.type === 'integer') return Number.isSafeInteger(value)
  if (schema.type === 'boolean') return typeof value === 'boolean'
  if (schema.type === 'null') return value === null
  if (schema.type === 'array') return Array.isArray(value) && value.every((item) => matchesSchema(item, schema.items as Record<string, unknown>))
  if (schema.type !== 'object' || !record(value) || !record(schema.properties)) return false
  const properties = schema.properties
  const required = Array.isArray(schema.required) ? schema.required : []
  if (required.some((name) => typeof name !== 'string' || !(name in value))) return false
  if (Object.keys(value).some((name) => !(name in properties))) return false
  return Object.entries(value).every(([name, child]) => matchesSchema(child, properties[name] as Record<string, unknown>))
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
