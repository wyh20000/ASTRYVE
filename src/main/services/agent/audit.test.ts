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

  it('strips display controls and bounds untrusted audit metadata', () => {
    const event: AuditEvent = {
      id: 'audit-3', timestamp: 1, taskId: 'task-1', workspaceId: 'workspace-1',
      actor: 'system', action: 'plugin.result', outcome: 'failure',
      metadata: {
        summary: `safe\u202E${'x'.repeat(2_000)}`,
        items: Array.from({ length: 80 }, (_, index) => index)
      }
    }

    const metadata = sanitizeAuditEvent(event).metadata as { summary: string; items: unknown[] }
    expect(metadata.summary).not.toContain('\u202E')
    expect(metadata.summary).toContain('[TRUNCATED]')
    expect(metadata.summary.length).toBeLessThan(1_020)
    expect(metadata.items).toHaveLength(51)
    expect(metadata.items.at(-1)).toBe('[TRUNCATED]')
  })
})
