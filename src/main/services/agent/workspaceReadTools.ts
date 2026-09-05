import type { ToolDefinition } from '../../../shared/agent'
import type { WorkspaceBoundaryService } from './workspace'

const MAX_MODEL_FILE_CHARS = 120_000
const MAX_LIST_RESULTS = 500
const MAX_SEARCH_RESULTS = 100

type ServiceProvider = () => WorkspaceBoundaryService

interface ListFilesArgs { path?: string; limit?: number }
interface ReadFileArgs { path: string; startLine?: number; endLine?: number }
interface SearchTextArgs { query: string; path?: string; limit?: number }

export function createWorkspaceReadTools(service: ServiceProvider): Array<ToolDefinition<any, unknown>> {
  return [listFilesTool(service), readFileTool(service), searchTextTool(service), findFilesTool(service)]
}

function listFilesTool(service: ServiceProvider): ToolDefinition<ListFilesArgs, unknown> {
  return {
    name: 'workspace.listFiles', operation: 'fs.read',
    description: 'List files and directories under the authorized project. Sensitive paths, links and generated trees are filtered by the host.',
    parameters: { type: 'object', properties: {
      path: { type: 'string', description: 'Project-relative directory; omit for project root.' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_RESULTS }
    }, additionalProperties: false },
    validateArgs: (value): value is ListFilesArgs => isClosed(value, ['path', 'limit']) &&
      optionalDirectory(value.path) && optionalInteger(value.limit, 1, MAX_LIST_RESULTS),
    execute: async (input, context) => safely(async () => {
      const entries = await service().listFiles(context.workspace.id, input.path ?? '')
      const limit = input.limit ?? 200
      return { entries: entries.slice(0, limit), total: entries.length, truncated: entries.length > limit }
    })
  }
}

function readFileTool(service: ServiceProvider): ToolDefinition<ReadFileArgs, unknown> {
  return {
    name: 'workspace.readFile', operation: 'fs.read',
    description: 'Read a UTF-8 text file inside the authorized project. Use line bounds for large files. Binary, sensitive, linked and out-of-project files are rejected.',
    parameters: { type: 'object', properties: {
      path: { type: 'string', description: 'Project-relative file path.' },
      startLine: { type: 'integer', minimum: 1 },
      endLine: { type: 'integer', minimum: 1 }
    }, required: ['path'], additionalProperties: false },
    validateArgs: (value): value is ReadFileArgs => isClosed(value, ['path', 'startLine', 'endLine']) &&
      requiredString(value.path) && optionalInteger(value.startLine, 1) && optionalInteger(value.endLine, 1) &&
      (value.startLine === undefined || value.endLine === undefined || value.endLine >= value.startLine),
    execute: async (input, context) => safely(async () => {
      const file = await service().readFile(context.workspace.id, input.path)
      const lines = file.content.split(/\r?\n/)
      const startLine = input.startLine ?? 1
      const requestedEnd = input.endLine ?? lines.length
      if (startLine > lines.length) throw new Error('起始行超出文件范围')
      const selected: string[] = []
      let chars = 0
      const finalRequestedLine = Math.min(requestedEnd, lines.length)
      for (let line = startLine; line <= finalRequestedLine; line += 1) {
        const value = lines[line - 1]
        const added = value.length + (selected.length > 0 ? 1 : 0)
        if (chars + added > MAX_MODEL_FILE_CHARS) {
          if (selected.length === 0) selected.push(value.slice(0, MAX_MODEL_FILE_CHARS))
          break
        }
        selected.push(value)
        chars += added
      }
      const endLine = startLine + selected.length - 1
      const truncated = endLine < lines.length || requestedEnd < lines.length
      const result: Record<string, unknown> = {
        path: file.path, content: selected.join('\n'), size: file.size, startLine,
        endLine, totalLines: lines.length, truncated
      }
      if (endLine < lines.length) result.nextStartLine = endLine + 1
      return result
    })
  }
}

function searchTextTool(service: ServiceProvider): ToolDefinition<SearchTextArgs, unknown> {
  return {
    name: 'workspace.searchText', operation: 'fs.search',
    description: 'Search literal text in safe UTF-8 files under the authorized project. Results contain project-relative path, line, column and preview.',
    parameters: { type: 'object', properties: {
      query: { type: 'string', minLength: 1, maxLength: 256 },
      path: { type: 'string', description: 'Optional project-relative directory.' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS }
    }, required: ['query'], additionalProperties: false },
    validateArgs: (value): value is SearchTextArgs => isClosed(value, ['query', 'path', 'limit']) &&
      requiredString(value.query, 256) && optionalDirectory(value.path) &&
      optionalInteger(value.limit, 1, MAX_SEARCH_RESULTS),
    execute: async (input, context) => safely(async () => {
      const matches = await service().searchText(context.workspace.id, input.query, input.path ?? '')
      const limit = input.limit ?? 50
      return { matches: matches.slice(0, limit), total: matches.length, truncated: matches.length > limit }
    })
  }
}

function findFilesTool(service: ServiceProvider): ToolDefinition<SearchTextArgs, unknown> {
  return {
    name: 'workspace.findFiles', operation: 'fs.search',
    description: 'Find project files and directories by a case-insensitive literal name fragment.',
    parameters: { type: 'object', properties: {
      query: { type: 'string', minLength: 1, maxLength: 256 },
      path: { type: 'string', description: 'Optional project-relative directory.' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS }
    }, required: ['query'], additionalProperties: false },
    validateArgs: (value): value is SearchTextArgs => isClosed(value, ['query', 'path', 'limit']) &&
      requiredString(value.query, 256) && optionalDirectory(value.path) &&
      optionalInteger(value.limit, 1, MAX_SEARCH_RESULTS),
    execute: async (input, context) => safely(async () => {
      const entries = await service().listFiles(context.workspace.id, input.path ?? '')
      const query = input.query.toLocaleLowerCase('en-US')
      const matches = entries.filter((entry) =>
        entry.name.toLocaleLowerCase('en-US').includes(query) ||
        entry.path.toLocaleLowerCase('en-US').includes(query))
      const limit = input.limit ?? 50
      return { matches: matches.slice(0, limit), total: matches.length, truncated: matches.length > limit }
    })
  }
}

function isClosed(value: unknown, allowed: string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).every((key) => allowed.includes(key))
}

function requiredString(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0')
}

/** Root-aware tools accept an omitted or empty path; both mean project root. */
function optionalDirectory(value: unknown): value is string | undefined {
  return value === undefined || (
    typeof value === 'string' && value.length <= 4096 && !value.includes('\0')
  )
}

function optionalInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number | undefined {
  return value === undefined || (Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max)
}

async function safely<T>(operation: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown }
    return { ok: false, error: {
      code: typeof candidate?.code === 'string' ? candidate.code : 'WORKSPACE_READ_FAILED',
      message: typeof candidate?.message === 'string' ? candidate.message : '工作区读取失败'
    } }
  }
}
