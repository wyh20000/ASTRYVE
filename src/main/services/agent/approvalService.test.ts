import { describe, expect, it } from 'vitest'
import type { ApprovalBinding, AuditEvent, PolicyDecision } from '../../../shared/agent'
import {
  ApprovalServiceError,
  BoundApprovalService,
  createApprovalRequest
} from './approvalService'

const decision: PolicyDecision = {
  outcome: 'ask',
  risk: 'medium',
  reasonCode: 'COMMAND_REQUIRES_APPROVAL',
  summary: '需要批准',
  normalizedTarget: '{"command":"test"}'
}

const binding: ApprovalBinding = {
  taskId: 'task-1',
  callId: 'call-1',
  toolName: 'process.run',
  workspaceId: 'workspace-1',
  environment: 'docker',
  operation: 'process.run',
  permissionMode: 'ask-every-time',
  policyReasonCode: 'COMMAND_REQUIRES_APPROVAL',
  normalizedTarget: decision.normalizedTarget!,
  commandPrefix: ['vitest', 'run'],
  plugin: { id: 'acme.audit', version: '2.4.0' }
}

describe('BoundApprovalService', () => {
  it('issues a bound token and consumes it only once', () => {
    const service = new BoundApprovalService(() => undefined, () => 1_000)
    const request = createApprovalRequest(binding, decision, { now: 1_000 })
    service.create(request)
    const grant = service.decide({
      requestId: request.id,
      outcome: 'approved',
      scope: 'once',
      decidedAt: 1_001
    })!

    expect(service.consume(grant.token, binding).id).toBe(request.id)
    expect(() => service.consume(grant.token, binding)).toThrowError(
      new ApprovalServiceError('UNKNOWN_TOKEN', 'Approval token is invalid or spent')
    )
  })

  it.each([
    ['taskId', 'task-2'],
    ['callId', 'call-2'],
    ['workspaceId', 'workspace-2'],
    ['environment', 'local'],
    ['normalizedTarget', '{"command":"expanded"}']
  ] as const)('rejects and spends a token when %s changes', (field, value) => {
    const service = new BoundApprovalService(() => undefined, () => 1_000)
    const request = createApprovalRequest(binding, decision, { now: 1_000 })
    service.create(request)
    const grant = service.decide({
      requestId: request.id,
      outcome: 'approved',
      decidedAt: 1_001
    })!
    expect(() => service.consume(grant.token, { ...binding, [field]: value })).toThrowError(
      ApprovalServiceError
    )
    expect(() => service.consume(grant.token, binding)).toThrowError(/invalid or spent/)
  })

  it('remembers only an exact approved task prefix and revokes it with the task', () => {
    const service = new BoundApprovalService(() => undefined, () => 1_000)
    const request = createApprovalRequest(binding, decision, { now: 1_000 })
    service.create(request)
    const grant = service.decide({
      requestId: request.id,
      outcome: 'approved',
      scope: 'task-prefix',
      decidedAt: 1_001
    })!
    service.consume(grant.token, binding)

    expect(service.isTaskPrefixApproved({ ...binding, callId: 'call-2' })).toBe(true)
    expect(
      service.isTaskPrefixApproved({
        ...binding,
        callId: 'call-2',
        commandPrefix: ['vitest', 'run', '--changed']
      })
    ).toBe(false)
    expect(
      service.isTaskPrefixApproved({
        ...binding,
        callId: 'call-2',
        normalizedTarget: '{"command":"same-prefix-different-cwd"}'
      })
    ).toBe(false)
    service.revokeTask(binding.taskId)
    expect(service.isTaskPrefixApproved({ ...binding, callId: 'call-3' })).toBe(false)
  })

  it('handles denial, expiry and emits audit events', () => {
    const events: AuditEvent[] = []
    let now = 1_000
    const service = new BoundApprovalService((event) => events.push(event), () => now)
    const denied = createApprovalRequest(binding, decision, { now, ttlMs: 100 })
    service.create(denied)
    expect(
      service.decide({ requestId: denied.id, outcome: 'denied', decidedAt: now + 1 })
    ).toBeUndefined()

    const expired = createApprovalRequest(binding, decision, { now, ttlMs: 100 })
    service.create(expired)
    now = 1_101
    expect(() =>
      service.decide({ requestId: expired.id, outcome: 'approved', decidedAt: now })
    ).toThrowError(/expired/)
    expect(events.map((event) => event.reasonCode)).toEqual([
      'APPROVAL_REQUESTED',
      'USER_DENIED',
      'APPROVAL_REQUESTED',
      'APPROVAL_EXPIRED'
    ])
  })

  it('audits the selected approval scope without recording target parameters', () => {
    const events: AuditEvent[] = []
    const sensitiveBinding = {
      ...binding,
      normalizedTarget: JSON.stringify({ command: 'npm publish', token: 'super-secret-token' })
    }
    const service = new BoundApprovalService((event) => events.push(event), () => 1_000)
    const request = createApprovalRequest(sensitiveBinding, {
      ...decision,
      normalizedTarget: sensitiveBinding.normalizedTarget
    }, { now: 1_000 })
    service.create(request)
    service.decide({ requestId: request.id, outcome: 'approved', scope: 'task-prefix', decidedAt: 1_001 })

    const approved = events.find((event) => event.reasonCode === 'USER_APPROVED')!
    expect(approved).toMatchObject({
      approvalScope: 'task-prefix', toolName: 'process.run',
      pluginId: 'acme.audit', pluginVersion: '2.4.0'
    })
    expect(JSON.stringify(approved)).not.toContain('super-secret-token')
    expect(JSON.stringify(approved)).not.toContain('npm publish')
  })

  it('rejects approval requests when trusted evidence is missing or tampered', () => {
    const service = new BoundApprovalService(() => undefined, () => 1_000)
    const request = createApprovalRequest(binding, decision, { now: 1_000 })

    expect(() => service.create({ ...request, toolName: '' })).toThrowError(ApprovalServiceError)
    expect(() => service.create({ ...request, policyReasonCode: 'TAMPERED_POLICY' })).toThrowError(ApprovalServiceError)
  })
})
