import type { ApprovalRequest, ApprovalScope, ToolInvocation, ToolExecutionContext, ToolDefinition } from '../../../shared/agent'
import { BoundApprovalService, createApprovalRequest } from './approvalService'
import { classifyOperation } from './operationClassifier'
import { DenyFirstPolicyEngine } from './policyEngine'

export type ApprovalPrompt = (request: ApprovalRequest, signal: AbortSignal) => Promise<ApprovalScope | undefined>

export class ToolAuthorization {
  constructor(
    private readonly prompt: ApprovalPrompt,
    private readonly waiting: (taskId: string, active: boolean) => void = () => undefined,
    private readonly approvals = new BoundApprovalService(),
    private readonly policy = new DenyFirstPolicyEngine()
  ) {}

  revokeTask(taskId: string): void { this.approvals.revokeTask(taskId) }

  async authorize(invocation: ToolInvocation, context: ToolExecutionContext, definition: ToolDefinition): Promise<boolean> {
    if (context.signal.aborted) return false
    const target = classifyOperation(definition.operation, invocation.args, context.workspace, invocation.toolName)
    const decision = this.policy.evaluate({
      permissionMode: context.permissionMode, workspace: context.workspace,
      invocation, operation: definition.operation, target
    })
    if (decision.outcome !== 'ask') return decision.outcome === 'allow'
    const binding = {
      taskId: context.taskId, callId: context.callId, workspaceId: context.workspace.id,
      environment: context.environment, operation: definition.operation,
      normalizedTarget: decision.normalizedTarget!,
      commandPrefix: target.type === 'command' ? target.commandPrefix : undefined
    }
    const reusableCommand = context.permissionMode === 'smart-approval' &&
      decision.reasonCode !== 'LONG_RUNNING_COMMAND_REQUIRES_APPROVAL'
    if (reusableCommand && this.approvals.isTaskPrefixApproved(binding)) return true
    const request = createApprovalRequest(binding, {
      ...decision, summary: `${decision.summary}（${decision.reasonCode}）`
    }, {
      scopeOptions: reusableCommand && binding.commandPrefix
        ? ['once', 'task-prefix'] : ['once']
    })
    this.approvals.create(request)
    const controller = new AbortController()
    const abort = () => controller.abort()
    context.signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, Math.max(0, request.expiresAt - Date.now()))
    let settleAbort!: () => void
    const cancelled = new Promise<undefined>((resolve) => {
      settleAbort = () => resolve(undefined)
      controller.signal.addEventListener('abort', settleAbort, { once: true })
    })
    this.waiting(context.taskId, true)
    try {
      const scope = await Promise.race([this.prompt(request, controller.signal), cancelled])
      if (context.signal.aborted || controller.signal.aborted) return false
      const grant = this.approvals.decide({ requestId: request.id,
        outcome: scope ? 'approved' : 'denied', scope, decidedAt: Date.now() })
      if (!grant) return false
      this.approvals.consume(grant.token, binding)
      return true
    } catch {
      this.approvals.revokeTask(context.taskId)
      return false
    } finally {
      clearTimeout(timer)
      context.signal.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', settleAbort)
      if (controller.signal.aborted) this.approvals.revokeTask(context.taskId)
      this.waiting(context.taskId, false)
    }
  }
}
