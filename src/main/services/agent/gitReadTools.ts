import type { ExecutionBackend, ToolDefinition, ToolExecutionContext } from '../../../shared/agent'
import { normalizeWorkspaceRelativePath } from './workspace'

interface GitStatusArgs { action?: 'status' }
interface GitDiffArgs { action?: 'diff'; staged?: boolean }
interface GitLogArgs { action?: 'log'; limit?: number }
interface GitShowArgs { action?: 'show'; revision: string; path: string }

interface NotGitRepository {
  isRepository: false
  message: string
}

const REVISION = /^(?:HEAD(?:~\d+|\^\d*)?|[a-f0-9]{7,40}|refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+)$/i

export function createGitReadTools(backend: ExecutionBackend): Array<ToolDefinition<any, unknown>> {
  return [statusTool(backend), diffTool(backend), logTool(backend), showTool(backend)]
}

function statusTool(backend: ExecutionBackend): ToolDefinition<GitStatusArgs, unknown> {
  return definition('git.status', 'Return concise Git working-tree status without reading file contents.',
    { action: { type: 'string', const: 'status', description: 'Optional compatibility field.' } }, [],
    (value): value is GitStatusArgs => isAction(value, 'status', []),
    async (_input, context) => runGit(backend, context, ['status', '--short', '--untracked-files=all', '--', '.']))
}

function diffTool(backend: ExecutionBackend): ToolDefinition<GitDiffArgs, unknown> {
  return definition('git.diff', 'Return a safe text diff for non-sensitive changed files in the authorized project.',
    { action: { type: 'string', const: 'diff', description: 'Optional compatibility field.' }, staged: { type: 'boolean' } }, [],
    (value): value is GitDiffArgs => isAction(value, 'diff', ['staged']) &&
      (value.staged === undefined || typeof value.staged === 'boolean'),
    async (input, context) => {
      const staged = input.staged === true
      const prefix = staged ? ['diff', '--cached'] : ['diff']
      const names = await runGit(backend, context, [...prefix, '--name-only', '-z', '--'])
      if (!names.ok) return names
      if (isNotGitRepository(names.value)) return names
      const raw = (names.value as { stdout: string }).stdout
      const paths: string[] = []
      let omitted = 0
      for (const path of raw.split('\0').filter(Boolean)) {
        try { paths.push(normalizeWorkspaceRelativePath(path)) } catch { omitted += 1 }
      }
      if (paths.length === 0) return { ok: true, value: { diff: '', files: [], omittedSensitiveFiles: omitted } }
      const result = await runGit(backend, context,
        [...prefix, '--no-ext-diff', '--no-textconv', '--no-color', '--', ...paths])
      if (!result.ok) return result
      return { ok: true, value: {
        diff: (result.value as { stdout: string }).stdout,
        files: paths, omittedSensitiveFiles: omitted,
        truncated: (result.value as { truncated: boolean }).truncated
      } }
    })
}

function logTool(backend: ExecutionBackend): ToolDefinition<GitLogArgs, unknown> {
  return definition('git.log', 'Return recent Git commit hashes, dates and subjects.',
    { action: { type: 'string', const: 'log', description: 'Optional compatibility field.' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, [],
    (value): value is GitLogArgs => isAction(value, 'log', ['limit']) &&
      (value.limit === undefined || isInteger(value.limit, 1, 50)),
    async (input, context) => runGit(backend, context, [
      'log', `-n${input.limit ?? 10}`, '--no-decorate', '--pretty=format:%H%x09%aI%x09%s'
    ]))
}

function showTool(backend: ExecutionBackend): ToolDefinition<GitShowArgs, unknown> {
  return definition('git.show', 'Read one non-sensitive project file from a specific Git revision.',
    {
      action: { type: 'string', const: 'show' },
      revision: { type: 'string', pattern: REVISION.source },
      path: { type: 'string' }
    }, ['revision', 'path'],
    (value): value is GitShowArgs => isAction(value, 'show', ['revision', 'path']) &&
      typeof value.revision === 'string' && REVISION.test(value.revision) &&
      typeof value.path === 'string' && value.path.length > 0,
    async (input, context) => {
      let path: string
      try { path = normalizeWorkspaceRelativePath(input.path) }
      catch (error) { return failure(error) }
      return runGit(backend, context, ['show', '--no-ext-diff', '--no-textconv', `${input.revision}:${path.replace(/\\/g, '/')}`])
    })
}

function definition<T>(name: string, description: string, properties: Record<string, unknown>, required: string[],
  validateArgs: (value: unknown) => value is T,
  execute: (input: T, context: ToolExecutionContext) => ReturnType<ToolDefinition<T>['execute']>): ToolDefinition<T, unknown> {
  return { name, operation: 'git.read', description,
    parameters: { type: 'object', properties, required, additionalProperties: false }, validateArgs, execute }
}

async function runGit(backend: ExecutionBackend, context: ToolExecutionContext, args: string[]) {
  // Git metadata is a bounded host-side read service, like workspace.readFile.
  // Docker copies deliberately exclude .git, so the user's command execution
  // environment must not reroute or disable these fixed read-only queries.
  try {
    const value = await backend.run({ taskId: context.taskId, callId: context.callId,
      workspace: context.workspace, executable: 'git', args, timeoutMs: 30_000, captureOnly: true }, context.signal)
    if (value.exitCode !== 0) {
      if (isNotRepositoryError(value.stderr)) {
        return { ok: true as const, value: {
          isRepository: false,
          message: '当前授权项目不是 Git 仓库，可继续使用文件工具进行分析'
        } satisfies NotGitRepository }
      }
      return { ok: false as const, error: {
        code: 'GIT_COMMAND_FAILED', message: value.stderr.trim().slice(0, 2000) || `Git 命令退出码 ${value.exitCode}`
      } }
    }
    return { ok: true as const, value }
  } catch (error) { return failure(error) }
}

function isNotRepositoryError(stderr: string): boolean {
  return /not a git repository/i.test(stderr)
}

function isNotGitRepository(value: unknown): value is NotGitRepository {
  return Boolean(value && typeof value === 'object' &&
    (value as { isRepository?: unknown }).isRepository === false)
}

function isAction(value: unknown, action: string, optional: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (record.action === undefined || record.action === action) &&
    Object.keys(record).every((key) => key === 'action' || optional.includes(key))
}

function isInteger(value: unknown, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
}

function failure(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown }
  return { ok: false as const, error: {
    code: typeof candidate?.code === 'string' ? candidate.code : 'GIT_READ_FAILED',
    message: typeof candidate?.message === 'string' ? candidate.message : 'Git 读取失败'
  } }
}
