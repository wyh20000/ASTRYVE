import { createHash, randomUUID } from 'node:crypto'
import type {
  AuditEvent,
  NormalizedOperationTarget,
  PolicyContext,
  PolicyDecision,
  PolicyEngine,
  RiskLevel
} from '../../../shared/agent'
import { serializeOperationTarget } from './operationClassifier'
import { sanitizeAuditEvent } from './audit'

export type AuditWriter = (event: AuditEvent) => void

export class DenyFirstPolicyEngine implements PolicyEngine {
  constructor(
    private readonly writeAudit: AuditWriter = () => undefined,
    private readonly now: () => number = Date.now
  ) {}

  evaluate(context: PolicyContext): PolicyDecision {
    const hardDenial = context.operation === 'network.enable' && context.invocation.environment !== 'docker'
      ? decision('deny', 'high', 'NETWORK_SCOPE_REQUIRES_DOCKER', '联网授权只适用于 Docker 沙箱', context.target)
      : evaluateHardDenial(context.target)
    const result = hardDenial ?? evaluateMode(context)
    this.writeAudit(sanitizeAuditEvent({
      id: randomUUID(),
      timestamp: this.now(),
      taskId: context.invocation.taskId,
      workspaceId: context.workspace.id,
      actor: 'policy',
      action: context.operation,
      outcome: result.outcome,
      risk: result.risk,
      reasonCode: result.reasonCode,
      target: hashAuditTarget(result.normalizedTarget),
      metadata: {
        permissionMode: context.permissionMode,
        environment: context.invocation.environment
      }
    }))
    return result
  }
}

function hashAuditTarget(target: string | undefined): string | undefined {
  return target
    ? `sha256:${createHash('sha256').update(target).digest('hex')}`
    : undefined
}

function evaluateHardDenial(target: NormalizedOperationTarget): PolicyDecision | undefined {
  if (
    (target.type === 'file' && target.outsideWorkspace) ||
    (target.type === 'host-patch' && target.outsideWorkspace)
  ) {
    return decision('deny', 'critical', 'PATH_OUTSIDE_WORKSPACE', '目标路径超出已授权工作区', target)
  }
  if (target.type === 'file' && target.sensitive) {
    return decision('deny', 'critical', 'SENSITIVE_PATH', '不允许读取或修改凭据和敏感配置', target)
  }
  if (target.type === 'network' && target.protocol === 'other') {
    return decision('deny', 'critical', 'UNSUPPORTED_NETWORK_PROTOCOL', '仅允许审核 HTTP(S) 网络访问', target)
  }
  if (target.type === 'command' && target.signals.credentialAccess) {
    return decision('deny', 'critical', 'CREDENTIAL_ACCESS', '命令可能访问凭据或敏感配置', target)
  }
  if (target.type === 'command' && target.signals.shellInterpreter) {
    return decision('deny', 'critical', 'SHELL_INTERPRETER_FORBIDDEN', '不允许通过 shell 解释器绕过结构化命令策略', target)
  }
  return undefined
}

function evaluateMode(context: PolicyContext): PolicyDecision {
  const target = context.target
  const readOperation =
    context.operation === 'fs.read' ||
    context.operation === 'fs.search' ||
    context.operation === 'git.read'

  if (context.operation === 'process.stop' && target.type === 'service-stop') {
    return decision('allow', 'low', 'TASK_SERVICE_STOP', '允许停止当前任务启动的服务', target)
  }

  if (readOperation) {
    return decision('allow', 'low', 'SAFE_READ', '允许工作区内只读操作', target)
  }

  if (context.permissionMode === 'read-only') {
    return decision('deny', riskFor(target), 'READ_ONLY_MODE', '只读模式禁止产生副作用', target)
  }

  if (context.permissionMode === 'ask-every-time') {
    return decision('ask', riskFor(target), 'EXPLICIT_APPROVAL_REQUIRED', '此操作需要用户批准', target)
  }

  if (context.operation === 'fs.patch' && context.invocation.environment === 'docker' &&
      target.type === 'file' && !target.destructive && !target.binary) {
    return decision('allow', 'low', 'SANDBOX_PATCH', '允许在隔离沙箱中生成临时补丁', target)
  }

  if (
    context.operation === 'process.run' &&
    context.invocation.environment === 'docker' &&
    target.type === 'command' &&
    target.signals.deterministicCheck &&
    !target.signals.shellSyntax &&
    !target.signals.destructive &&
    !target.signals.dependencyChange &&
    !target.signals.longRunning
  ) {
    return decision('allow', 'low', 'SANDBOX_DETERMINISTIC_CHECK', '允许沙箱内确定性的低风险检查', target)
  }

  return decision('ask', riskFor(target), reasonForApproval(target), '此操作需要用户批准', target)
}

function riskFor(target: NormalizedOperationTarget): RiskLevel {
  if (target.type === 'service-stop') return 'low'
  if (target.type === 'host-patch') return 'high'
  if (target.type === 'network') return 'high'
  if (target.type === 'git' && target.write) return 'high'
  if (target.type === 'file' && (target.destructive || target.binary)) return 'high'
  if (target.type === 'command') {
    if (target.signals.destructive || target.signals.shellSyntax) return 'critical'
    if (target.signals.dependencyChange || target.signals.longRunning) return 'high'
    return 'medium'
  }
  return 'medium'
}

function reasonForApproval(target: NormalizedOperationTarget): string {
  if (target.type === 'host-patch') return 'HOST_WRITEBACK_REQUIRES_APPROVAL'
  if (target.type === 'network') return 'NETWORK_REQUIRES_APPROVAL'
  if (target.type === 'git' && target.write) return 'GIT_WRITE_REQUIRES_APPROVAL'
  if (target.type === 'command') {
    if (target.signals.shellSyntax) return 'SHELL_SYNTAX_REQUIRES_APPROVAL'
    if (target.signals.destructive) return 'DESTRUCTIVE_COMMAND_REQUIRES_APPROVAL'
    if (target.signals.dependencyChange) return 'DEPENDENCY_CHANGE_REQUIRES_APPROVAL'
    if (target.signals.longRunning) return 'LONG_RUNNING_COMMAND_REQUIRES_APPROVAL'
    if (target.signals.projectScript) return 'PROJECT_SCRIPT_REQUIRES_APPROVAL'
    return 'COMMAND_REQUIRES_APPROVAL'
  }
  return 'WRITE_REQUIRES_APPROVAL'
}

function decision(
  outcome: PolicyDecision['outcome'],
  risk: RiskLevel,
  reasonCode: string,
  summary: string,
  target: NormalizedOperationTarget
): PolicyDecision {
  return { outcome, risk, reasonCode, summary, normalizedTarget: serializeOperationTarget(target) }
}
