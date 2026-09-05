import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from '../../../shared/agent'
import { AuditJournal } from './auditJournal'
import { DenyFirstPolicyEngine } from './policyEngine'

let directory: string
const event: AuditEvent = {
  id: 'event-1', timestamp: 1, taskId: 'task-1', workspaceId: 'workspace-1',
  actor: 'policy', action: 'fs.read', outcome: 'allow', reasonCode: 'SAFE_READ'
}
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-audit-test-')) })
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }) })

describe('persistent decision audit', () => {
  it('persists decisions across restart, hashes targets and discards arbitrary secret metadata', () => {
    const file = path.join(directory, 'audit.json')
    const journal = new AuditJournal(file)
    journal.write({ ...event, target: 'private-command-and-password', metadata: { custom: 'secret-data', apiKey: 'secret-key' } })
    new AuditJournal(file).write({ ...event, id: 'event-2', outcome: 'deny' })
    const raw = fs.readFileSync(file, 'utf8')
    expect(raw).not.toContain('private-command')
    expect(raw).not.toContain('secret')
    expect(JSON.parse(raw).map((entry: AuditEvent) => entry.outcome)).toEqual(['allow', 'deny'])
    expect(JSON.parse(raw)[0].target).toMatch(/^sha256:/)
  })

  it('preserves the previous file when replacement fails and removes incomplete temporary writes', () => {
    const file = path.join(directory, 'audit.json')
    const journal = new AuditJournal(file)
    journal.write(event)
    const before = fs.readFileSync(file, 'utf8')
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk error') })
    expect(() => journal.write({ ...event, id: 'failed-event' })).toThrow('操作已阻止')
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
    expect(fs.readdirSync(directory)).toEqual(['audit.json'])
    journal.write({ ...event, id: 'retry-event' })
    expect(fs.readFileSync(file, 'utf8')).not.toContain('failed-event')
  })

  it('never returns an allow decision if auditing fails', () => {
    const engine = new DenyFirstPolicyEngine(() => { throw new Error('disk unavailable') })
    expect(() => engine.evaluate({
      permissionMode: 'read-only', operation: 'fs.read',
      workspace: { id: 'workspace-1', rootPath: directory, realRootPath: directory, createdAt: 1 },
      invocation: { taskId: 'task-1', callId: 'call-1', toolName: 'workspace.read', args: {}, workspaceId: 'workspace-1', environment: 'local', permissionMode: 'read-only' },
      target: { type: 'file', path: directory, outsideWorkspace: false, sensitive: false, destructive: false, binary: false }
    })).toThrow('disk unavailable')
  })

  it('retains only the latest 500 decisions and rejects a corrupted journal', () => {
    const file = path.join(directory, 'audit.json')
    fs.writeFileSync(file, JSON.stringify(Array.from({ length: 500 }, (_, index) => ({ ...event, id: `event-${index}` }))))
    new AuditJournal(file).write({ ...event, id: 'event-latest' })
    const records = JSON.parse(fs.readFileSync(file, 'utf8')) as AuditEvent[]
    expect(records).toHaveLength(500)
    expect(records[0].id).toBe('event-1')
    expect(records.at(-1)?.id).toBe('event-latest')
    fs.writeFileSync(file, '{partial')
    expect(() => new AuditJournal(file)).toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe('{partial')
  })
})
