import { describe, expect, it } from 'vitest'
import type { Session } from '../../../shared/types'
import type { WorkspaceGrant } from '../../../shared/agent'
import { isPluginAllowedInChat, isWorkSessionForWorkspace } from './sessionScope'

const grant: WorkspaceGrant = { id: 'project-a', rootPath: 'D:\\project-a',
  realRootPath: 'D:\\project-a', createdAt: 1 }
const work: Session = { id: 'work', title: '工作', kind: 'work', workspaceId: 'project-a',
  projectPath: 'D:\\project-a', pinned: false, createdAt: 1, updatedAt: 1 }

describe('project session scope', () => {
  it('allows only the matching authorized work session', () => {
    expect(isWorkSessionForWorkspace(work, grant, grant.id)).toBe(true)
    expect(isWorkSessionForWorkspace({ ...work, kind: 'chat' }, grant, grant.id)).toBe(false)
    expect(isWorkSessionForWorkspace({ ...work, workspaceId: 'project-b' }, grant, grant.id)).toBe(false)
    expect(isWorkSessionForWorkspace({ ...work, projectPath: 'D:\\project-b' }, grant, grant.id)).toBe(false)
    expect(isWorkSessionForWorkspace(work, undefined, grant.id)).toBe(false)
  })

  it('allows a migrated work session only for the same path, never an unrelated grant', () => {
    expect(isWorkSessionForWorkspace({ ...work, workspaceId: null }, grant, grant.id)).toBe(true)
    expect(isWorkSessionForWorkspace({ ...work, workspaceId: null }, { ...grant, rootPath: 'D:\\other' }, grant.id)).toBe(false)
  })
})

describe('chat plugin scope', () => {
  it('keeps network and browser plugins but excludes local coding effects', () => {
    expect(isPluginAllowedInChat(['network', 'browser.read'])).toBe(true)
    expect(isPluginAllowedInChat(['workspace.read'])).toBe(false)
    expect(isPluginAllowedInChat(['workspace.write'])).toBe(false)
    expect(isPluginAllowedInChat(['process'])).toBe(false)
  })
})
