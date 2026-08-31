import { describe, expect, it } from 'vitest'
import type { AuditEvent } from '../../../shared/agent'
import { REDACTED, sanitizeAuditEvent } from './audit'

describe('sanitizeAuditEvent', () => {
  it('redacts credentials, prompts, responses and environments recursively', () => {
    const event: AuditEvent = {
      id: 'audit-1',
      timestamp: 1,
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      actor: 'policy',
      action: 'process.run',
      outcome: 'ask',
      metadata: {
        executable: 'npm',
        apiKey: 'secret-value',
        nested: {
          authorization: 'Bearer abc.def.ghi',
          prompt: 'private request',
          environment: { PATH: 'hidden' },
          safeSummary: 'run tests'
        }
      }
    }

    expect(sanitizeAuditEvent(event).metadata).toEqual({
      executable: 'npm',
      apiKey: REDACTED,
      nested: {
        authorization: REDACTED,
        prompt: REDACTED,
        environment: REDACTED,
        safeSummary: 'run tests'
      }
    })
  })

  it('redacts secret-looking values even under an innocent key', () => {
    const event: AuditEvent = {
      id: 'audit-2',
      timestamp: 1,
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      actor: 'system',
      action: 'test',
      outcome: 'success',
      metadata: { header: 'Bearer abcdefghijklmnop' }
    }
    expect(sanitizeAuditEvent(event).metadata).toEqual({ header: REDACTED })
  })
})
