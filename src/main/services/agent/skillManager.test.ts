import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AuditEvent } from '../../../shared/agent'
import type { SkillMetadata } from '../../../shared/types'

const mocks = vi.hoisted(() => ({
  audit: vi.fn<(event: AuditEvent) => void>(),
  disabledPlugins: new Set<string>()
}))
vi.mock('./taskRuntimeManager', () => ({
  getToolRegistry: () => ({ list: () => [] }),
  writeAgentAudit: mocks.audit
}))
vi.mock('../settings', () => ({
  getDisabledSkillIds: () => new Set<string>(),
  getDisabledPluginIds: () => mocks.disabledPlugins
}))

import { initPluginRegistry } from './pluginManager'
import { auditSkillUse, initSkillRegistry, listPluginSkills } from './skillManager'

beforeEach(() => {
  mocks.audit.mockClear()
  mocks.disabledPlugins.clear()
})

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

describe('Plugin skill preview', () => {
  it('reads real skill metadata even while the containing plugin is disabled', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'ai-agent-plugin-skills-'))
    const pluginRoot = join(userData, 'plugins', 'review-pack')
    const skillRoot = join(pluginRoot, 'skills', 'review')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(pluginRoot, 'plugin.json'), JSON.stringify({
      schemaVersion: 1, id: 'review-pack', name: 'Review Pack', version: '1.0.0',
      description: 'Review code', permissions: [], skills: './skills'
    }))
    await writeFile(join(skillRoot, 'SKILL.md'), [
      '---', 'name: review', 'description: Review the current project', '---', '', 'Review carefully.'
    ].join('\n'))
    mocks.disabledPlugins.add('review-pack')
    initPluginRegistry(userData)
    initSkillRegistry(userData)

    const result = await listPluginSkills('review-pack')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'review', pluginId: 'review-pack', source: 'plugin' })
  })
})
