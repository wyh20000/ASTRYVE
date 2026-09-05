import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.directory } }))

describe('project settings persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    if (state.directory) fs.rmSync(state.directory, { recursive: true, force: true })
  })

  it('reloads each project and rolls back memory when atomic replacement fails', async () => {
    state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-settings-test-'))
    vi.resetModules()
    const settings = await import('./settings')
    const first = { workspaceId: 'project-a', permissionMode: 'read-only' as const, executionEnvironment: 'docker' as const }
    const second = { ...first, workspaceId: 'project-b', permissionMode: 'ask-every-time' as const }
    settings.setAgentProjectPreferences(first)
    settings.setAgentProjectPreferences(second)
    const before = fs.readFileSync(path.join(state.directory, 'ai-agent-settings.json'), 'utf8')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk error') })
    expect(() => settings.setAgentProjectPreferences({ ...first, permissionMode: 'smart-approval' })).toThrow('项目设置保存失败')
    expect(settings.getAgentProjectPreferences(first.workspaceId)).toEqual(first)
    expect(fs.readFileSync(path.join(state.directory, 'ai-agent-settings.json'), 'utf8')).toBe(before)
    vi.resetModules()
    const reloaded = await import('./settings')
    reloaded.initSettings()
    expect(reloaded.getAgentProjectPreferences(first.workspaceId)).toEqual(first)
    expect(reloaded.getAgentProjectPreferences(second.workspaceId)).toEqual(second)
  })
})
