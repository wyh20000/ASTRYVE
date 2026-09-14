import { describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from '../../../shared/agent'
import { auditPluginOperation } from './pluginAudit'

describe('plugin operation audit', () => {
  it('records a requested update before mutation and its successful result without arbitrary details', async () => {
    const events: AuditEvent[] = []
    const action = vi.fn(async () => 'installed')

    await expect(auditPluginOperation(
      (event) => events.push(event),
      { action: 'plugin.update', pluginId: 'acme.tools', pluginVersion: '2.0.0' },
      action
    )).resolves.toBe('installed')

    expect(events).toEqual([
      expect.objectContaining({ action: 'plugin.update', outcome: 'ask', reasonCode: 'PLUGIN_UPDATE_REQUESTED', pluginId: 'acme.tools', pluginVersion: '2.0.0' }),
      expect.objectContaining({ action: 'plugin.update', outcome: 'success', reasonCode: 'PLUGIN_UPDATE_SUCCEEDED', pluginId: 'acme.tools', pluginVersion: '2.0.0' })
    ])
    expect(action).toHaveBeenCalledOnce()
  })

  it('retains the original operation error after recording a failure', async () => {
    const events: AuditEvent[] = []
    const failure = new Error('download unavailable')

    await expect(auditPluginOperation(
      (event) => events.push(event),
      { action: 'plugin.update', pluginId: 'acme.tools', pluginVersion: '2.0.0' },
      async () => { throw failure }
    )).rejects.toBe(failure)

    expect(events.at(-1)).toMatchObject({ outcome: 'failure', reasonCode: 'PLUGIN_UPDATE_FAILED' })
    expect(JSON.stringify(events)).not.toContain('download unavailable')
  })
})
