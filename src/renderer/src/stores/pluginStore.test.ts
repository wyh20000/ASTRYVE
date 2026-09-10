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
    usePluginStore.setState({ items: [], loading: false, error: undefined })
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
})
