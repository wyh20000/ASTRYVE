import type { ExecutionBackend, ToolDefinition } from '../../../shared/agent'
import { LOCAL_EXECUTABLES, type LocalExecutableName } from './trustedExecutable'

export interface ProcessRunArgs {
  executable: LocalExecutableName
  args: string[]
  timeoutMs?: number
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
      if (context.environment !== 'local' || backend.environment !== 'local') {
        return { ok: false, error: { code: 'WRONG_EXECUTION_ENVIRONMENT', message: '本工具只允许在已启用的本机执行环境运行' } }
      }
      try {
        const result = await backend.run({
          taskId: context.taskId,
          callId: context.callId,
          workspace: context.workspace,
          executable: input.executable,
          args: [...input.args],
          timeoutMs: input.timeoutMs ?? 120_000
        }, context.signal)
        return { ok: true, value: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'COMMAND_FAILED'
        return { ok: false, error: { code: commandErrorCode(message), message } }
      }
    }
  }
}

function isProcessRunArgs(value: unknown): value is ProcessRunArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  return keys.every((key) => ['executable', 'args', 'timeoutMs'].includes(key)) &&
    typeof input.executable === 'string' &&
    (LOCAL_EXECUTABLES as readonly string[]).includes(input.executable) &&
    Array.isArray(input.args) && input.args.length <= 256 &&
    input.args.every((arg) => typeof arg === 'string' && arg.length <= 8192 && !arg.includes('\0')) &&
    (input.timeoutMs === undefined ||
      (Number.isSafeInteger(input.timeoutMs) && Number(input.timeoutMs) >= 1000 && Number(input.timeoutMs) <= 600_000))
}

function commandErrorCode(message: string): string {
  if (message.includes('CANCEL')) return 'COMMAND_CANCELLED'
  if (message.includes('TIMEOUT')) return 'COMMAND_TIMEOUT'
  if (message.startsWith('EXECUTABLE_NOT_FOUND')) return 'EXECUTABLE_NOT_FOUND'
  if (message === 'EXECUTABLE_NOT_ALLOWED') return message
  return 'COMMAND_FAILED'
}
