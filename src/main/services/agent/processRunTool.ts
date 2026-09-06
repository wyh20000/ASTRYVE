import type {
  ExecutionBackend,
  ServiceExecutionBackend,
  ToolDefinition
} from '../../../shared/agent'
import { LOCAL_EXECUTABLES, type LocalExecutableName } from './trustedExecutable'

export interface ProcessRunArgs {
  executable: LocalExecutableName
  args: string[]
  timeoutMs?: number
}

export interface ProcessStartArgs extends ProcessRunArgs {
  expectedPorts?: number[]
}

interface ProcessStopArgs { serviceId: string }

export function createProcessTools(
  backend: ServiceExecutionBackend,
  dockerBackend?: ExecutionBackend
): Array<ToolDefinition<any, unknown>> {
  const localRun = createProcessRunTool(backend)
  const processRun = dockerBackend
    ? routeProcessRunTool(localRun, createProcessRunTool(dockerBackend))
    : localRun
  return [processRun, createProcessStartTool(backend), createProcessStopTool(backend)]
}

export function createProcessRunTool(backend: ExecutionBackend): ToolDefinition<ProcessRunArgs, unknown> {
  return {
    name: 'process.run',
    operation: 'process.run',
    description: 'Run an allowlisted executable in the authorized project root without a shell. Available executables: git, node, npm, python, python3, py.',
    parameters: {
      type: 'object',
      properties: {
        executable: { type: 'string', enum: [...LOCAL_EXECUTABLES] },
        args: { type: 'array', items: { type: 'string', maxLength: 8192 }, maxItems: 256 },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000 }
      },
      required: ['executable', 'args'],
      additionalProperties: false
    },
    validateArgs: isProcessRunArgs,
    execute: async (input, context) => {
      if (context.environment !== backend.environment) {
        return { ok: false, error: { code: 'WRONG_EXECUTION_ENVIRONMENT', message: '命令后端与用户选择的执行环境不一致' } }
      }
      try {
        const result = await backend.run({
          taskId: context.taskId,
          callId: context.callId,
          workspace: context.workspace,
          executable: input.executable,
          args: [...input.args],
          timeoutMs: input.timeoutMs ?? 120_000,
          dockerImageId: context.dockerImageId
        }, context.signal)
        return { ok: true, value: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'COMMAND_FAILED'
        return { ok: false, error: { code: commandErrorCode(message), message } }
      }
    }
  }
}

function createProcessStartTool(
  backend: ServiceExecutionBackend
): ToolDefinition<ProcessStartArgs, unknown> {
  return {
    name: 'process.startService',
    operation: 'process.start',
    description: 'Start a task-scoped long-running service using an allowlisted executable. It is always approval-gated, returns the real child PID, and is forcibly stopped when the task ends.',
    parameters: {
      type: 'object',
      properties: {
        executable: { type: 'string', enum: [...LOCAL_EXECUTABLES] },
        args: { type: 'array', items: { type: 'string', maxLength: 8192 }, maxItems: 256 },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000 },
        expectedPorts: {
          type: 'array', items: { type: 'integer', minimum: 1, maximum: 65535 },
          maxItems: 16, uniqueItems: true,
          description: 'Ports expected to be opened by the service; these are displayed as declared ports, not host-verified listeners.'
        }
      },
      required: ['executable', 'args'],
      additionalProperties: false
    },
    validateArgs: isProcessStartArgs,
    execute: async (input, context) => {
      if (context.environment !== 'local' || backend.environment !== 'local') {
        return { ok: false, error: { code: 'WRONG_EXECUTION_ENVIRONMENT', message: '长期服务当前只支持已启用的本机执行环境' } }
      }
      try {
        const value = await backend.startService({
          taskId: context.taskId,
          callId: context.callId,
          workspace: context.workspace,
          executable: input.executable,
          args: [...input.args],
          timeoutMs: input.timeoutMs ?? 600_000,
          expectedPorts: input.expectedPorts ? [...input.expectedPorts] : undefined
        }, context.signal)
        return { ok: true, value }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'SERVICE_START_FAILED'
        return { ok: false, error: { code: commandErrorCode(message), message } }
      }
    }
  }
}

function createProcessStopTool(
  backend: ServiceExecutionBackend
): ToolDefinition<ProcessStopArgs, unknown> {
  return {
    name: 'process.stop',
    operation: 'process.stop',
    description: 'Stop one long-running service previously started by this same task.',
    parameters: {
      type: 'object',
      properties: { serviceId: { type: 'string', minLength: 1, maxLength: 128 } },
      required: ['serviceId'],
      additionalProperties: false
    },
    validateArgs: (value): value is ProcessStopArgs => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const input = value as Record<string, unknown>
      return Object.keys(input).every((key) => key === 'serviceId') &&
        typeof input.serviceId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(input.serviceId)
    },
    execute: async (input, context) => {
      if (context.environment !== backend.environment) {
        return { ok: false, error: { code: 'WRONG_EXECUTION_ENVIRONMENT', message: '当前执行环境不支持长期服务停止' } }
      }
      const stopped = await backend.stopService(context.taskId, input.serviceId)
      return stopped
        ? { ok: true, value: { serviceId: input.serviceId, stopped: true } }
        : { ok: false, error: { code: 'SERVICE_NOT_FOUND', message: '当前任务中不存在该服务或服务已经停止' } }
    }
  }
}

function routeProcessRunTool(
  local: ToolDefinition<ProcessRunArgs, unknown>,
  docker: ToolDefinition<ProcessRunArgs, unknown>
): ToolDefinition<ProcessRunArgs, unknown> {
  return {
    ...local,
    description: 'Run an allowlisted executable in the explicitly selected local or Docker execution environment.',
    execute: (input, context) => (context.environment === 'docker' ? docker : local).execute(input, context)
  }
}

function isProcessRunArgs(value: unknown): value is ProcessRunArgs {
  return isBaseProcessArgs(value, ['executable', 'args', 'timeoutMs'])
}

function isBaseProcessArgs(value: unknown, allowedKeys: string[]): value is ProcessRunArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  return keys.every((key) => allowedKeys.includes(key)) &&
    typeof input.executable === 'string' &&
    (LOCAL_EXECUTABLES as readonly string[]).includes(input.executable) &&
    Array.isArray(input.args) && input.args.length <= 256 &&
    input.args.every((arg) => typeof arg === 'string' && arg.length <= 8192 && !arg.includes('\0')) &&
    (input.timeoutMs === undefined ||
      (Number.isSafeInteger(input.timeoutMs) && Number(input.timeoutMs) >= 1000 && Number(input.timeoutMs) <= 600_000))
}

function isProcessStartArgs(value: unknown): value is ProcessStartArgs {
  if (!isBaseProcessArgs(value, ['executable', 'args', 'timeoutMs', 'expectedPorts'])) return false
  const input = value as unknown as Record<string, unknown>
  if (input.expectedPorts === undefined) return true
  return Array.isArray(input.expectedPorts) && input.expectedPorts.length <= 16 &&
    new Set(input.expectedPorts).size === input.expectedPorts.length &&
    input.expectedPorts.every((port) => Number.isSafeInteger(port) && Number(port) >= 1 && Number(port) <= 65_535)
}

function commandErrorCode(message: string): string {
  if (message.includes('CANCEL')) return 'COMMAND_CANCELLED'
  if (message.includes('TIMEOUT')) return 'COMMAND_TIMEOUT'
  if (message.startsWith('EXECUTABLE_NOT_FOUND')) return 'EXECUTABLE_NOT_FOUND'
  if (message === 'EXECUTABLE_NOT_ALLOWED') return message
  return 'COMMAND_FAILED'
}
