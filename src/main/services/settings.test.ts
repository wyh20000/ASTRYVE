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

  it('persists disabled Skills and rolls back a failed save', async () => {
    state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-settings-test-'))
    vi.resetModules()
    const settings = await import('./settings')
    const id = `project:${'a'.repeat(12)}:x`
    settings.setSkillEnabled(id, false)
    expect(settings.getDisabledSkillIds()).toEqual(new Set([id]))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk error') })
    expect(() => settings.setSkillEnabled(id, true)).toThrow('项目设置保存失败')
    expect(settings.getDisabledSkillIds()).toEqual(new Set([id]))
    vi.resetModules()
    const reloaded = await import('./settings')
    reloaded.initSettings()
    expect(reloaded.getDisabledSkillIds()).toEqual(new Set([id]))
  })

  it('persists disabled plugins independently from Skills', async () => {
    state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-plugin-settings-test-'))
    vi.resetModules()
    const settings = await import('./settings')
    settings.setPluginEnabled('acme.browser', false)
    expect(settings.getDisabledPluginIds()).toEqual(new Set(['acme.browser']))
    expect(settings.getDisabledSkillIds()).toEqual(new Set())
    vi.resetModules()
    const reloaded = await import('./settings')
    reloaded.initSettings()
    expect(reloaded.getDisabledPluginIds()).toEqual(new Set(['acme.browser']))
  })

  it('persists the safe automatic plugin update preference with a default-off policy', async () => {
    state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-plugin-update-settings-'))
    vi.resetModules()
    const settings = await import('./settings')
    expect(settings.getPluginPreferences()).toEqual({ autoUpdate: false })
    settings.setPluginPreferences({ autoUpdate: true })
    vi.resetModules()
    const reloaded = await import('./settings'); reloaded.initSettings()
    expect(reloaded.getPluginPreferences()).toEqual({ autoUpdate: true })
  })

  it('fails closed instead of silently enabling a plugin when the disabled list is full', async () => {
    state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-plugin-settings-cap-'))
    vi.resetModules()
    const settings = await import('./settings')
    for (let index = 0; index < 500; index += 1) settings.setPluginEnabled(`plugin.${String(index).padStart(3, '0')}`, false)
    expect(() => settings.setPluginEnabled('plugin.overflow', false)).toThrow('禁用列表已满')
    expect(settings.getDisabledPluginIds()).toHaveLength(500)
    expect(settings.getDisabledPluginIds().has('plugin.overflow')).toBe(false)
  })

  it('normalizes and persists browser site policies', async () => {
    state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-browser-settings-test-'))
    vi.resetModules()
    const settings = await import('./settings')
    settings.setBrowserPreferences({ allowAllSites: false, allowedOrigins: ['https://Example.com/path'], blockedOrigins: ['https://blocked.test/a'] })
    expect(settings.getBrowserPreferences()).toEqual({ allowAllSites: false, allowedOrigins: ['https://example.com'], blockedOrigins: ['https://blocked.test'] })
    vi.resetModules()
    const reloaded = await import('./settings'); reloaded.initSettings()
    expect(reloaded.getBrowserPreferences().blockedOrigins).toEqual(['https://blocked.test'])
  })
})
