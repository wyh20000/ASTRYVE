import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginMetadata } from '@shared/types'
import { usePluginStore } from './pluginStore'

const plugin: PluginMetadata = {
  id: 'acme.browser', name: 'Acme Browser', version: '1.0.0', description: 'Browser tools',
  source: 'installed', sourceFormat: 'native', enabled: true, status: 'ready', permissions: ['browser.read'],
  capabilities: ['Read'], components: ['tools'], errors: []
}

describe('pluginStore', () => {
  beforeEach(() => {
    usePluginStore.setState({ items: [], marketEntries: [], marketSources: [], preferences: { autoUpdate: false }, loading: false, mutating: false, error: undefined })
  })

  it('loads only plugin metadata returned by the trusted preload API', async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, data: [plugin] })
    const setEnabled = vi.fn()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agent: { plugins: { list, setEnabled } } } })
    await usePluginStore.getState().load()
    expect(list).toHaveBeenCalledOnce()
    expect(usePluginStore.getState().items).toEqual([plugin])
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
})
