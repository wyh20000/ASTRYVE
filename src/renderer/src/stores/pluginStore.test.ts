import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginMcpPluginView, PluginMetadata, SkillMetadata } from '@shared/types'
import { usePluginStore } from './pluginStore'

const plugin: PluginMetadata = {
  id: 'acme.browser', name: 'Acme Browser', version: '1.0.0', description: 'Browser tools',
  source: 'installed', sourceFormat: 'native', enabled: true, status: 'ready', permissions: ['browser.read'],
  capabilities: ['Read'], components: ['tools'], errors: []
}

describe('pluginStore', () => {
  beforeEach(() => {
    usePluginStore.setState({ items: [], marketEntries: [], marketSources: [], skillsByPlugin: {}, preferences: { autoUpdate: false }, loading: false, mutating: false, error: undefined })
  })

  it('loads only plugin metadata returned by the trusted preload API', async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, data: [plugin] })
    const setEnabled = vi.fn()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agent: { plugins: { list, setEnabled } } } })
    await usePluginStore.getState().load()
    expect(list).toHaveBeenCalledOnce()
    expect(usePluginStore.getState().items).toEqual([plugin])
  })

  it('loads an installed plugin skill preview without enabling the plugin', async () => {
    const skills: SkillMetadata[] = [{
      id: 'plugin:review', name: 'review', displayName: 'Review', description: 'Review code', source: 'plugin',
      enabled: true, active: false, autoTrigger: true, requestedTools: [], allowedTools: [], resources: [],
      invocation: 'model', toolPolicy: 'inherit', installKind: 'external', pluginId: plugin.id, errors: []
    }]
    const listSkills = vi.fn().mockResolvedValue({ ok: true, data: skills })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agent: { plugins: { listSkills } } } })
    await usePluginStore.getState().loadPluginSkills(plugin.id)
    expect(listSkills).toHaveBeenCalledWith({ id: plugin.id })
    expect(usePluginStore.getState().skillsByPlugin[plugin.id]).toEqual(skills)
  })

  it('keeps the current list and exposes a concise error when toggling fails', async () => {
    const setEnabled = vi.fn().mockResolvedValue({ ok: false, error: { code: 'ERR', message: '保存失败' } })
    const list = vi.fn()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agent: { plugins: { list, setEnabled } } } })
    usePluginStore.setState({ items: [plugin] })
    await usePluginStore.getState().setEnabled(plugin.id, false)
    expect(usePluginStore.getState().items).toEqual([plugin])
    expect(usePluginStore.getState().error).toBe('保存失败')
  })

  it('imports through the main-process picker and replaces the list with its result', async () => {
    const list = vi.fn()
    const setEnabled = vi.fn()
    const importLocal = vi.fn().mockResolvedValue({ ok: true, data: [plugin] })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agent: { plugins: { list, setEnabled, importLocal } } } })
    const accepted = await usePluginStore.getState().importLocal('zip')
    expect(accepted).toBe(true)
    expect(importLocal).toHaveBeenCalledWith({ kind: 'zip' })
    expect(usePluginStore.getState().items).toEqual([plugin])
  })

  it('refreshes the installed list after a rollback and exposes lifecycle errors', async () => {
    const restored = { ...plugin, version: '0.9.0', enabled: false }
    const rollback = vi.fn().mockResolvedValue({ ok: true, data: [restored] })
    const backups = vi.fn().mockResolvedValue({
      ok: true,
      data: [{ pluginId: plugin.id, version: '0.9.0', createdAt: 1 }]
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { agent: { plugins: { rollback, backups } } }
    })

    await expect(usePluginStore.getState().loadBackups(plugin.id)).resolves.toHaveLength(1)
    await expect(usePluginStore.getState().rollback(plugin.id, '0.9.0')).resolves.toBe(true)
    expect(rollback).toHaveBeenCalledWith({ id: plugin.id, version: '0.9.0' })
    expect(usePluginStore.getState().items).toEqual([restored])
  })

  it('releases the busy state and retains installed plugins when rollback fails', async () => {
    const rollback = vi.fn().mockResolvedValue({ ok: false, error: { code: 'ERR', message: '回滚失败' } })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agent: { plugins: { rollback } } } })
    usePluginStore.setState({ items: [plugin] })
    await expect(usePluginStore.getState().rollback(plugin.id, '0.9.0')).resolves.toBe(false)
    expect(usePluginStore.getState()).toMatchObject({ items: [plugin], mutating: false, error: '回滚失败' })
  })

  it('synchronizes the installed list after a market install', async () => {
    const installed = { ...plugin, enabled: false }
    const installMarket = vi.fn().mockResolvedValue({ ok: true, data: [installed] })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agent: { plugins: { installMarket } } } })
    await expect(usePluginStore.getState().installMarket('official', plugin.id, plugin.version!)).resolves.toBe(true)
    expect(installMarket).toHaveBeenCalledWith({ sourceId: 'official', id: plugin.id, version: plugin.version })
    expect(usePluginStore.getState()).toMatchObject({ items: [installed], mutating: false, error: undefined })
  })

  it('loads and saves the safe automatic update preference through the trusted API', async () => {
    const getPreferences = vi.fn().mockResolvedValue({ ok: true, data: { autoUpdate: true } })
    const setPreferences = vi.fn().mockResolvedValue({ ok: true, data: { autoUpdate: false } })
    Object.defineProperty(globalThis, 'window', {
      configurable: true, value: { agent: { plugins: { getPreferences, setPreferences } } }
    })
    await usePluginStore.getState().loadPreferences()
    expect(usePluginStore.getState().preferences).toEqual({ autoUpdate: true })
    await usePluginStore.getState().setAutoUpdate(false)
    expect(setPreferences).toHaveBeenCalledWith({ autoUpdate: false })
    expect(usePluginStore.getState().preferences).toEqual({ autoUpdate: false })
  })

  it('loads sanitized MCP connection state and submits credentials only to the trusted API', async () => {
    const connections: PluginMcpPluginView[] = [{
      pluginId: plugin.id, pluginName: plugin.name, enabled: true, restricted: false,
      servers: [{ id: 'api', serverOrigin: 'https://api.example.com', auth: 'api-key', state: 'pending', compatibleConnections: [] }]
    }]
    const listConnections = vi.fn().mockResolvedValue({ ok: true, data: connections })
    const connectMcp = vi.fn().mockResolvedValue({ ok: true, data: [{
      ...connections[0], servers: [{ ...connections[0].servers[0], state: 'connected', connectionId: '11111111-1111-4111-8111-111111111111' }]
    }] })
    Object.defineProperty(globalThis, 'window', {
      configurable: true, value: { agent: { plugins: { listConnections, connectMcp } } }
    })

    await usePluginStore.getState().loadConnections()
    expect(usePluginStore.getState().connections).toEqual(connections)
    await expect(usePluginStore.getState().connectMcp({
      pluginId: plugin.id, serverId: 'api', credential: 'one-time-secret'
    })).resolves.toBe(true)
    expect(connectMcp).toHaveBeenCalledWith({
      pluginId: plugin.id, serverId: 'api', credential: 'one-time-secret'
    })
    expect(JSON.stringify(usePluginStore.getState())).not.toContain('one-time-secret')
    expect(usePluginStore.getState().connections[0].servers[0].state).toBe('connected')
  })

  it('releases MCP busy state and preserves current connection data when retry fails', async () => {
    const current: PluginMcpPluginView[] = [{
      pluginId: plugin.id, pluginName: plugin.name, enabled: true, restricted: false,
      servers: [{ id: 'api', serverOrigin: 'https://api.example.com', auth: 'api-key', state: 'failed', compatibleConnections: [] }]
    }]
    const retryMcp = vi.fn().mockResolvedValue({ ok: false, error: { code: 'MCP_CONNECT_ERR', message: '连接失败' } })
    Object.defineProperty(globalThis, 'window', {
      configurable: true, value: { agent: { plugins: { retryMcp } } }
    })
    usePluginStore.setState({ connections: current })

    await expect(usePluginStore.getState().retryMcp({ pluginId: plugin.id, serverId: 'api' })).resolves.toBe(false)
    expect(usePluginStore.getState()).toMatchObject({ connections: current, mutatingConnection: false, error: '连接失败' })
  })
})
