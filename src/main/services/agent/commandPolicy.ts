import path from 'node:path'
import type {
  CommandRiskSignals,
  NormalizedCommand,
  WorkspaceGrant
} from '../../../shared/agent'

const MAX_ARGS = 256
const MAX_ARG_LENGTH = 8_192
const MAX_TIMEOUT_MS = 10 * 60_000
const SAFE_ENV_KEYS = new Set(['CI', 'LANG', 'LC_ALL', 'NO_COLOR', 'NODE_ENV', 'TERM'])
const SHELL_INTERPRETERS = new Set([
  'bash',
  'cmd',
  'cmd.exe',
  'fish',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'sh',
  'zsh'
])
const SHELL_SYNTAX = /(?:&&|\|\||[|<>;`]|\$\(|\$\{|\r|\n)/
const WILDCARD = /[*?]/
const SENSITIVE_ARGUMENT = /(?:\.env(?:\.|$)|\.ssh(?:[\\/]|$)|credentials?|id_rsa|api[-_]?key|password|secret|token)/i
const DEPENDENCY_COMMAND = /^(?:install|add|remove|uninstall|update|upgrade|ci)$/i
const LONG_RUNNING_COMMAND = /^(?:dev|serve|start|watch)$/i
const CHECK_COMMAND = /^(?:build|check|lint|test|typecheck|verify)$/i
const DETERMINISTIC_CHECK_EXECUTABLES = new Set([
  'eslint',
  'eslint.cmd',
  'jest',
  'jest.cmd',
  'tsc',
  'tsc.cmd',
  'vitest',
  'vitest.cmd'
])

export class CommandPolicyError extends Error {
  constructor(
    readonly code:
      | 'INVALID_COMMAND'
      | 'RAW_SHELL_FORBIDDEN'
      | 'CWD_OUTSIDE_WORKSPACE'
      | 'UNSAFE_ENVIRONMENT',
    message: string
  ) {
    super(message)
    this.name = 'CommandPolicyError'
  }
}

export interface CommandInput {
  executable: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  expectedPorts?: number[]
}

export interface ClassifiedCommand {
  command: NormalizedCommand
  signals: CommandRiskSignals
  commandPrefix: string[]
}

/** Only structured argv is accepted. No renderer/model supplied shell string is parsed. */
export function normalizeCommand(input: unknown, workspace: WorkspaceGrant): ClassifiedCommand {
  if (!isCommandInput(input)) {
    throw new CommandPolicyError('INVALID_COMMAND', 'Command must use executable and argv fields')
  }

  const executable = input.executable.trim()
  if (!executable || executable.length > 1_024 || /[\0\r\n]/.test(executable)) {
    throw new CommandPolicyError('INVALID_COMMAND', 'Executable is invalid')
  }
  if (SHELL_SYNTAX.test(executable) || (/\s/.test(executable) && !path.isAbsolute(executable))) {
    throw new CommandPolicyError('RAW_SHELL_FORBIDDEN', 'Raw shell commands are not accepted')
  }
  if (
    input.args.length > MAX_ARGS ||
    input.args.some((arg) => arg.length > MAX_ARG_LENGTH || arg.includes('\0'))
  ) {
    throw new CommandPolicyError('INVALID_COMMAND', 'Command arguments exceed the safety limit')
  }

  const cwd = path.resolve(workspace.realRootPath, input.cwd ?? '.')
  if (!isInside(workspace.realRootPath, cwd)) {
    throw new CommandPolicyError('CWD_OUTSIDE_WORKSPACE', 'Command cwd is outside the workspace')
  }

  const env = normalizeEnvironment(input.env)
  const timeoutMs = input.timeoutMs ?? 120_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new CommandPolicyError('INVALID_COMMAND', 'Command timeout is outside the allowed range')
  }

  const expectedPorts = normalizeExpectedPorts(input.expectedPorts)
  const command = {
    executable,
    args: [...input.args],
    cwd,
    env,
    timeoutMs,
    ...(expectedPorts.length > 0 ? { expectedPorts } : {})
  }
  const executableName = path.basename(executable).toLowerCase()
  const tokens = [executableName, ...input.args.map((arg) => arg.toLowerCase())]
  const packageAction = getPackageAction(executableName, input.args)
  const safeProjectCheck = packageAction === 'run' && typeof input.args[1] === 'string' &&
    input.args[1].split(/[:-]/).some((part) => CHECK_COMMAND.test(part))
  const destructive =
    isDestructive(executableName, input.args) ||
    (WILDCARD.test(input.args.join(' ')) && ['rm', 'del', 'erase', 'rmdir'].includes(executableName))

  return {
    command,
    commandPrefix: [executable, ...input.args],
    signals: {
      shellSyntax: input.args.some((arg) => SHELL_SYNTAX.test(arg)),
      shellInterpreter: SHELL_INTERPRETERS.has(executableName),
      destructive,
      dependencyChange: Boolean(packageAction && DEPENDENCY_COMMAND.test(packageAction)),
      longRunning: tokens.some((token) => LONG_RUNNING_COMMAND.test(token)),
      credentialAccess: input.args.some((arg) => SENSITIVE_ARGUMENT.test(arg)),
      projectScript: Boolean(packageAction === 'run' || executableName === 'make'),
      deterministicCheck:
        !destructive &&
        !SHELL_INTERPRETERS.has(executableName) &&
        !input.args.some((arg) => SHELL_SYNTAX.test(arg)) &&
        (DETERMINISTIC_CHECK_EXECUTABLES.has(executableName) || safeProjectCheck)
    }
  }
}

function isCommandInput(value: unknown): value is CommandInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.executable === 'string' &&
    Array.isArray(candidate.args) &&
    candidate.args.every((arg) => typeof arg === 'string') &&
    (candidate.cwd === undefined || typeof candidate.cwd === 'string') &&
    (candidate.timeoutMs === undefined || typeof candidate.timeoutMs === 'number') &&
    (candidate.expectedPorts === undefined || Array.isArray(candidate.expectedPorts)) &&
    (candidate.env === undefined || isStringRecord(candidate.env))
  )
}

function normalizeExpectedPorts(value: number[] | undefined): number[] {
  if (value === undefined) return []
  if (
    value.length > 16 ||
    !value.every((port) => Number.isSafeInteger(port) && port >= 1 && port <= 65_535) ||
    new Set(value).size !== value.length
  ) {
    throw new CommandPolicyError('INVALID_COMMAND', 'Expected service ports are invalid')
  }
  return [...value]
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string')
  )
}

function normalizeEnvironment(input: Record<string, string> | undefined): Record<string, string> {
  const entries = Object.entries(input ?? {})
  if (
    entries.length > SAFE_ENV_KEYS.size ||
    entries.some(
      ([key, value]) =>
        !SAFE_ENV_KEYS.has(key.toUpperCase()) || value.length > 1_024 || /[\0\r\n]/.test(value)
    )
  ) {
    throw new CommandPolicyError(
      'UNSAFE_ENVIRONMENT',
      'Only the documented non-sensitive environment fields are accepted'
    )
  }
  return Object.fromEntries(entries.map(([key, value]) => [key.toUpperCase(), value]))
}

function getPackageAction(executable: string, args: string[]): string | undefined {
  if (['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'bun'].includes(executable)) {
    return args[0]?.toLowerCase()
  }
  return undefined
}

function isDestructive(executable: string, args: string[]): boolean {
  if (['rm', 'del', 'erase', 'rmdir', 'format', 'mkfs'].includes(executable)) return true
  if (executable === 'git') {
    const action = args[0]?.toLowerCase()
    return action === 'clean' || action === 'reset'
  }
  return false
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
