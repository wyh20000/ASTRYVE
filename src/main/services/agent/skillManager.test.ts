import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from '../../../shared/agent'
import type { SkillMetadata } from '../../../shared/types'

const mocks = vi.hoisted(() => ({ audit: vi.fn<(event: AuditEvent) => void>() }))
vi.mock('./taskRuntimeManager', () => ({
  getToolRegistry: () => ({ list: () => [] }),
  writeAgentAudit: mocks.audit
}))
vi.mock('../settings', () => ({ getDisabledSkillIds: () => new Set<string>() }))

import { auditSkillUse } from './skillManager'

beforeEach(() => mocks.audit.mockClear())

describe('Skill audit', () => {
  it('records instruction and resource identities without their contents', () => {
    const skill: SkillMetadata = {
      id: `project:${'a'.repeat(12)}:docs-helper`, name: 'docs-helper', displayName: 'Docs Helper', description: 'secret description',
      source: 'project', enabled: true, active: true, autoTrigger: false,
      requestedTools: [], allowedTools: [], resources: ['references/style.md'], invocation: 'user',
      toolPolicy: 'inherit', installKind: 'external', version: 'abc123', errors: []
    }
    auditSkillUse('task-1', 'workspace-1', [skill])
    expect(mocks.audit).toHaveBeenCalledTimes(2)
    expect(mocks.audit.mock.calls.map(([event]) => event.action)).toEqual(['skill.use', 'skill.resource'])
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('secret description')
    expect(mocks.audit.mock.calls[0][0].target).toContain('@abc123')
    expect(mocks.audit.mock.calls[1][0].target).toContain('references/style.md')
  })
})
