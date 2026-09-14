import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { PERMISSION_MODES } from '../../../shared/agent'
import type {
  ApprovalBinding,
  ApprovalDecision,
  ApprovalGrant,
  ApprovalRequest,
  ApprovalScope,
  ApprovalService,
  AuditEvent,
  PolicyDecision
} from '../../../shared/agent'
import type { AuditWriter } from './policyEngine'
import { sanitizeAuditEvent } from './audit'

const DEFAULT_TTL_MS = 2 * 60_000

interface StoredGrant {
  grant: ApprovalGrant
  request: ApprovalRequest
}

interface PrefixApproval {
  taskId: string
  workspaceId: string
  environment: ApprovalBinding['environment']
  operation: ApprovalBinding['operation']
  toolName: string
  plugin?: { id: string; version?: string }
  permissionMode: ApprovalRequest['permissionMode']
  policyReasonCode: string
  commandPrefix: string[]
  normalizedTarget: string
}

export class ApprovalServiceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_REQUEST'
      | 'UNKNOWN_REQUEST'
      | 'EXPIRED'
      | 'INVALID_SCOPE'
      | 'UNKNOWN_TOKEN'
      | 'BINDING_MISMATCH',
    message: string
  ) {
    super(message)
    this.name = 'ApprovalServiceError'
  }
}

export class BoundApprovalService implements ApprovalService {
  private readonly requests = new Map<string, ApprovalRequest>()
  private readonly grants = new Map<string, StoredGrant>()
  private readonly prefixApprovals: PrefixApproval[] = []

  constructor(
    private readonly writeAudit: AuditWriter = () => undefined,
    private readonly now: () => number = Date.now
  ) {}

  create(request: ApprovalRequest): void {
    if (
      request.expiresAt <= request.createdAt ||
      request.expiresAt <= this.now() ||
      !isTrustedEvidence(request) ||
      request.bindingHash !== hashRequestBinding(request)
    ) {
      throw new ApprovalServiceError('INVALID_REQUEST', 'Approval request binding is invalid')
    }
    if (this.requests.has(request.id)) {
      throw new ApprovalServiceError('INVALID_REQUEST', 'Approval request ID is already in use')
    }
    this.requests.set(request.id, structuredClone(request))
    this.audit(request, 'ask', 'APPROVAL_REQUESTED')
  }

  decide(decision: ApprovalDecision): ApprovalGrant | undefined {
    const request = this.requests.get(decision.requestId)
    if (!request) throw new ApprovalServiceError('UNKNOWN_REQUEST', 'Approval request was not found')
    this.requests.delete(request.id)

    if (request.expiresAt <= this.now() || decision.decidedAt > request.expiresAt) {
      this.audit(request, 'deny', 'APPROVAL_EXPIRED')
      throw new ApprovalServiceError('EXPIRED', 'Approval request has expired')
    }
    if (decision.outcome === 'denied') {
      this.audit(request, 'deny', 'USER_DENIED')
      return undefined
    }

    const scope = decision.scope ?? 'once'
    if (!request.scopeOptions.includes(scope) || (scope === 'task-prefix' && !request.commandPrefix)) {
      this.audit(request, 'deny', 'INVALID_APPROVAL_SCOPE')
      throw new ApprovalServiceError('INVALID_SCOPE', 'Approval scope is not valid for this request')
    }

    const grant: ApprovalGrant = {
      token: randomBytes(32).toString('base64url'),
      requestId: request.id,
      scope,
      expiresAt: request.expiresAt
    }
    this.grants.set(grant.token, { grant, request })
    this.audit(request, 'allow', 'USER_APPROVED', scope)
    return grant
  }

  consume(token: string, binding: ApprovalBinding): ApprovalRequest {
    const stored = this.grants.get(token)
    if (!stored) throw new ApprovalServiceError('UNKNOWN_TOKEN', 'Approval token is invalid or spent')
    this.grants.delete(token)

    if (stored.grant.expiresAt <= this.now()) {
      this.audit(stored.request, 'deny', 'APPROVAL_TOKEN_EXPIRED')
      throw new ApprovalServiceError('EXPIRED', 'Approval token has expired')
    }
    if (stored.request.bindingHash !== hashApprovalBinding(binding)) {
      this.audit(stored.request, 'deny', 'APPROVAL_BINDING_MISMATCH')
      throw new ApprovalServiceError(
        'BINDING_MISMATCH',
        'Approval does not match this task, call, workspace, environment, or target'
      )
    }

    if (stored.grant.scope === 'task-prefix' && stored.request.commandPrefix) {
      this.prefixApprovals.push({
        taskId: stored.request.taskId,
        workspaceId: stored.request.workspaceId,
        environment: stored.request.environment,
        operation: stored.request.operation,
        toolName: stored.request.toolName,
        plugin: stored.request.plugin ? { ...stored.request.plugin } : undefined,
        permissionMode: stored.request.permissionMode,
        policyReasonCode: stored.request.policyReasonCode,
        commandPrefix: [...stored.request.commandPrefix],
        normalizedTarget: stored.request.normalizedTarget
      })
    }
    this.audit(stored.request, 'success', 'APPROVAL_TOKEN_CONSUMED')
    return structuredClone(stored.request)
  }

  isTaskPrefixApproved(binding: ApprovalBinding): boolean {
    if (!binding.commandPrefix) return false
    const approved = this.prefixApprovals.some(
      (approval) =>
        approval.taskId === binding.taskId &&
        approval.workspaceId === binding.workspaceId &&
        approval.environment === binding.environment &&
        approval.operation === binding.operation &&
        approval.toolName === binding.toolName &&
        samePlugin(approval.plugin, binding.plugin) &&
        approval.permissionMode === binding.permissionMode &&
        approval.policyReasonCode === binding.policyReasonCode &&
        approval.normalizedTarget === binding.normalizedTarget &&
        arraysEqual(approval.commandPrefix, binding.commandPrefix!)
    )
    if (approved) {
      this.writeAudit({
        id: randomUUID(), timestamp: this.now(), taskId: binding.taskId,
        workspaceId: binding.workspaceId, actor: 'policy', action: 'approval', outcome: 'allow',
        reasonCode: 'TASK_APPROVAL_REUSED', target: `sha256:${hashApprovalBinding(binding)}`,
        toolName: binding.toolName, pluginId: binding.plugin?.id, pluginVersion: binding.plugin?.version,
        approvalScope: 'task-prefix'
      })
    }
    return approved
  }

  revokeTask(taskId: string): void {
    for (const [id, request] of this.requests) {
      if (request.taskId === taskId) this.requests.delete(id)
    }
    for (const [token, stored] of this.grants) {
      if (stored.request.taskId === taskId) this.grants.delete(token)
    }
    for (let index = this.prefixApprovals.length - 1; index >= 0; index -= 1) {
      if (this.prefixApprovals[index].taskId === taskId) this.prefixApprovals.splice(index, 1)
    }
  }

  private audit(
    request: ApprovalRequest,
    outcome: AuditEvent['outcome'],
    reasonCode: string,
    scope?: ApprovalScope
  ): void {
    this.writeAudit(sanitizeAuditEvent({
      id: randomUUID(),
      timestamp: this.now(),
      taskId: request.taskId,
      workspaceId: request.workspaceId,
      actor: 'user',
      action: 'approval',
      outcome,
      risk: request.risk,
      reasonCode,
      target: `sha256:${request.bindingHash}`,
      toolName: request.toolName,
      pluginId: request.plugin?.id,
      pluginVersion: request.plugin?.version,
      approvalScope: scope,
      metadata: { requestId: request.id, environment: request.environment }
    }))
  }
}

export function createApprovalRequest(
  binding: ApprovalBinding,
  decision: PolicyDecision,
  options: {
    now?: number
    ttlMs?: number
    scopeOptions?: ApprovalScope[]
  } = {}
): ApprovalRequest {
  if (decision.outcome !== 'ask') {
    throw new ApprovalServiceError('INVALID_REQUEST', 'Only ask decisions create approvals')
  }
  const createdAt = options.now ?? Date.now()
  const scopeOptions = options.scopeOptions ?? (binding.commandPrefix ? ['once', 'task-prefix'] : ['once'])
  const request: ApprovalRequest = {
    id: randomUUID(),
    taskId: binding.taskId,
    callId: binding.callId,
    toolName: binding.toolName,
    plugin: binding.plugin ? { ...binding.plugin } : undefined,
    workspaceId: binding.workspaceId,
    environment: binding.environment,
    operation: binding.operation,
    permissionMode: binding.permissionMode,
    policyReasonCode: binding.policyReasonCode,
    normalizedTarget: binding.normalizedTarget,
    bindingHash: hashApprovalBinding(binding),
    commandPrefix: binding.commandPrefix ? [...binding.commandPrefix] : undefined,
    summary: decision.summary,
    risk: decision.risk,
    scopeOptions,
    createdAt,
    expiresAt: createdAt + (options.ttlMs ?? DEFAULT_TTL_MS)
  }
  return request
}

export function hashApprovalBinding(binding: ApprovalBinding): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        taskId: binding.taskId,
        callId: binding.callId,
        toolName: binding.toolName,
        plugin: binding.plugin ?? null,
        workspaceId: binding.workspaceId,
        environment: binding.environment,
        operation: binding.operation,
        permissionMode: binding.permissionMode,
        policyReasonCode: binding.policyReasonCode,
        normalizedTarget: binding.normalizedTarget,
        commandPrefix: binding.commandPrefix ?? null
      })
    )
    .digest('hex')
}

function hashRequestBinding(request: ApprovalRequest): string {
  return hashApprovalBinding(request)
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function samePlugin(
  left?: { id: string; version?: string },
  right?: { id: string; version?: string }
): boolean {
  return left?.id === right?.id && left?.version === right?.version
}

function isTrustedEvidence(request: ApprovalRequest): boolean {
  return /^[a-z][a-z0-9.-]{0,127}$/i.test(request.toolName) &&
    (!request.plugin || (/^[a-z0-9][a-z0-9._-]{1,63}$/.test(request.plugin.id) &&
      (request.plugin.version === undefined || /^[a-z0-9][a-z0-9.+_-]{0,63}$/i.test(request.plugin.version)))) &&
    PERMISSION_MODES.includes(request.permissionMode) &&
    /^[A-Z][A-Z0-9_]{2,127}$/.test(request.policyReasonCode)
}
