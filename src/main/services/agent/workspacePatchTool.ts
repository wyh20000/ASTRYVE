import type { ToolDefinition } from '../../../shared/agent'
import type { PatchWorkspaceService, StructuredTextChange } from './patchWorkspaceService'

interface PatchArgs { path: string; changes: StructuredTextChange[]; destructive?: boolean; binary?: false }

export function createWorkspacePatchTool(service: PatchWorkspaceService): ToolDefinition<PatchArgs, unknown> {
  return {
    name: 'workspace.patch', operation: 'fs.patch',
    description: 'Apply structured UTF-8 text changes to a task-scoped sandbox overlay. This never writes the host project. For an existing file, first call workspace.readFile without line bounds and require contentExact true, then preserve its exact BOM/line endings in content and pass its exact hash as expectedHash. Never patch from a truncated read. New files use expectedHash null.',
    parameters: { type: 'object', properties: {
      path: { type: 'string', description: 'Primary project-relative path for policy display.' },
      changes: { type: 'array', minItems: 1, maxItems: 20, items: {
        oneOf: [
          { type: 'object', properties: { type: { const: 'write' }, path: { type: 'string' }, expectedHash: { type: ['string', 'null'], description: 'Exact 64-character file hash returned by workspace.readFile; the sha256: prefix is optional. Use null only for a new file.' }, content: { type: 'string' } }, required: ['type', 'path', 'expectedHash', 'content'], additionalProperties: false },
          { type: 'object', properties: { type: { const: 'delete' }, path: { type: 'string' }, expectedHash: { type: 'string', description: 'Exact file hash returned by workspace.readFile; sha256: prefix optional.' } }, required: ['type', 'path', 'expectedHash'], additionalProperties: false },
          { type: 'object', properties: { type: { const: 'rename' }, from: { type: 'string' }, path: { type: 'string' }, expectedHash: { type: 'string', description: 'Exact source hash returned by workspace.readFile; sha256: prefix optional.' } }, required: ['type', 'from', 'path', 'expectedHash'], additionalProperties: false }
        ], description: 'Closed structured UTF-8 text change.'
      } },
      destructive: { type: 'boolean' }, binary: { type: 'boolean', enum: [false] }
    }, required: ['path', 'changes'], additionalProperties: false },
    validateArgs: (value): value is PatchArgs => isPatchArgs(value),
    execute: async (input, context) => {
      try {
        return { ok: true, value: await service.apply(context.taskId, context.workspace.id, input.changes) }
      } catch (error) {
        const candidate = error as { code?: unknown; message?: unknown }
        return { ok: false, error: {
          code: typeof candidate?.code === 'string' ? candidate.code : 'PATCH_FAILED',
          message: typeof candidate?.message === 'string' ? candidate.message : '沙箱补丁失败'
        } }
      }
    }
  }
}

function isPatchArgs(value: unknown): value is PatchArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!Object.keys(record).every((key) => ['path', 'changes', 'destructive', 'binary'].includes(key)) ||
      typeof record.path !== 'string' || !record.path || !Array.isArray(record.changes) ||
      record.changes.length < 1 || record.changes.length > 20 ||
      (record.destructive !== undefined && typeof record.destructive !== 'boolean') ||
      (record.binary !== undefined && record.binary !== false)) return false
  return record.changes.every((change) => Boolean(change) && typeof change === 'object' && !Array.isArray(change))
}
