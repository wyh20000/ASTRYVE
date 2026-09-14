import { randomUUID } from 'node:crypto'
import type { AuditEvent } from '../../../shared/agent'
import type { AuditWriter } from './policyEngine'

export interface PluginOperationEvidence {
  action: 'plugin.install' | 'plugin.update' | 'plugin.rollback' | 'plugin.uninstall'
  pluginId: string
  pluginVersion?: string
}

/** Audit the trusted identity and lifecycle only; errors and package content never enter the journal. */
export async function auditPluginOperation<T>(
  writeAudit: AuditWriter,
  evidence: PluginOperationEvidence,
  operation: () => Promise<T>
): Promise<T> {
  writeAudit(pluginEvent(evidence, 'ask', reason(evidence.action, 'REQUESTED')))
  try {
    const result = await operation()
    try { writeAudit(pluginEvent(evidence, 'success', reason(evidence.action, 'SUCCEEDED'))) } catch { /* mutation already completed */ }
    return result
  } catch (error) {
    try { writeAudit(pluginEvent(evidence, 'failure', reason(evidence.action, 'FAILED'))) } catch { /* preserve original error */ }
    throw error
  }
}

function pluginEvent(
  evidence: PluginOperationEvidence,
  outcome: AuditEvent['outcome'],
  reasonCode: string
): AuditEvent {
  return {
    id: randomUUID(), timestamp: Date.now(), taskId: 'settings', workspaceId: 'application',
    actor: 'user', action: evidence.action, outcome, risk: 'medium', reasonCode,
    pluginId: evidence.pluginId, pluginVersion: evidence.pluginVersion
  }
}

function reason(action: PluginOperationEvidence['action'], suffix: string): string {
  return `PLUGIN_${action.slice('plugin.'.length).toUpperCase()}_${suffix}`
}
