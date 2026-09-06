import type { ToolDefinition } from '../../../shared/agent'
import type { PatchWorkspaceService } from './patchWorkspaceService'

interface ApplyPatchArgs { paths: string[]; patchHash: string }

export function createHostPatchTool(service: PatchWorkspaceService): ToolDefinition<ApplyPatchArgs, unknown> {
  return {
    name: 'workspace.applyPatch', operation: 'fs.apply-host',
    description: 'After explicit approval, atomically write the exact task sandbox patch to the host project. The paths and SHA-256 must exactly match workspace.patch output.',
    parameters: { type: 'object', properties: {
      paths: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
      patchHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }
    }, required: ['paths', 'patchHash'], additionalProperties: false },
    validateArgs: (value): value is ApplyPatchArgs => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const record = value as Record<string, unknown>
      return Object.keys(record).every((key) => ['paths', 'patchHash'].includes(key)) &&
        Array.isArray(record.paths) && record.paths.length >= 1 && record.paths.length <= 20 &&
        record.paths.every((path) => typeof path === 'string' && path.length > 0 && path.length <= 4096) &&
        typeof record.patchHash === 'string' && /^[a-f0-9]{64}$/.test(record.patchHash)
    },
    approvalSummary: (input, context) => service.approvalPreview(
      context.taskId, context.workspace.id, input.patchHash, input.paths
    ),
    execute: async (input, context) => {
      try {
        return { ok: true, value: await service.applyToHost(
          context.taskId, context.workspace.id, input.patchHash, input.paths
        ) }
      } catch (error) {
        const candidate = error as { code?: unknown; message?: unknown }
        return { ok: false, error: {
          code: typeof candidate?.code === 'string' ? candidate.code : 'HOST_PATCH_FAILED',
          message: typeof candidate?.message === 'string' ? candidate.message : '宿主写回失败'
        } }
      }
    }
  }
}
