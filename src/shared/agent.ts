/**
 * P3 Agent 执行内核的跨进程契约。
 *
 * 本文件只定义数据和能力边界，不包含任何真实文件写入或命令执行。
 */

export const PERMISSION_MODES = ['read-only', 'ask-every-time', 'smart-approval'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export const EXECUTION_ENVIRONMENTS = ['docker', 'local'] as const
export type ExecutionEnvironment = (typeof EXECUTION_ENVIRONMENTS)[number]

export const TASK_STATUSES = [
  'queued',
  'planning',
  'running',
  'waiting-approval',
  'stopping',
  'completed',
  'failed',
  'cancelled'
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled'] as const
export type TerminalTaskStatus = (typeof TERMINAL_TASK_STATUSES)[number]

export const OPERATION_KINDS = [
  'fs.read',
  'fs.search',
  'fs.patch',
  'fs.apply-host',
  'process.run',
  'network.enable',
  'git.read',
  'git.write'
] as const
export type OperationKind = (typeof OPERATION_KINDS)[number]

export type PolicyOutcome = 'allow' | 'ask' | 'deny'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ApprovalScope = 'once' | 'task-prefix'

export interface WorkspaceGrant {
  id: string
  rootPath: string
  realRootPath: string
  /** 授权时根目录的设备/文件标识，用于发现同路径替换。 */
  rootIdentity?: string
  createdAt: number
  lastOpenedAt?: number
}

/** renderer 可见的脱敏工作区信息；不包含用于边界判断的 realRootPath。 */
export interface WorkspaceSummary {
  id: string
  name: string
  displayPath: string
  createdAt: number
  lastOpenedAt: number
}

export interface WorkspaceFileEntry {
  path: string
  name: string
  kind: 'file' | 'directory'
  size?: number
}

export interface WorkspaceFileContent {
  path: string
  content: string
  size: number
  encoding: 'utf-8'
}

export interface WorkspaceSearchMatch {
  path: string
  line: number
  column: number
  preview: string
}

export interface WorkspaceListInput {
  workspaceId: string
  path?: string
}

export interface WorkspaceReadInput {
  workspaceId: string
  path: string
}

export interface WorkspaceReadManyInput {
  workspaceId: string
  paths: string[]
}

export interface WorkspaceSearchInput {
  workspaceId: string
  query: string
  path?: string
}

export interface ActivateWorkspaceInput {
  sessionId: string
  workspaceId: string
}

export interface ToolInvocation {
  taskId: string
  callId: string
  toolName: string
  args: unknown
  workspaceId: string
  environment: ExecutionEnvironment
}

export interface ToolResult<TResult = unknown> {
  ok: boolean
  value?: TResult
  error?: { code: string; message: string }
}

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string
  operation: OperationKind
  description: string
  validateArgs: (input: unknown) => input is TArgs
  execute: (input: TArgs, context: ToolExecutionContext) => Promise<ToolResult<TResult>>
}

export interface ToolExecutionContext {
  taskId: string
  callId: string
  workspace: WorkspaceGrant
  environment: ExecutionEnvironment
  signal: AbortSignal
}

export interface PolicyContext {
  permissionMode: PermissionMode
  workspace: WorkspaceGrant
  invocation: ToolInvocation
  operation: OperationKind
}

export interface PolicyDecision {
  outcome: PolicyOutcome
  risk: RiskLevel
  reasonCode: string
  summary: string
  normalizedTarget?: string
}

export interface PolicyEngine {
  evaluate: (context: PolicyContext) => PolicyDecision
}

export interface ApprovalRequest {
  id: string
  taskId: string
  callId: string
  workspaceId: string
  environment: ExecutionEnvironment
  operation: OperationKind
  summary: string
  risk: RiskLevel
  scopeOptions: ApprovalScope[]
  createdAt: number
  expiresAt: number
}

export interface ApprovalDecision {
  requestId: string
  outcome: 'approved' | 'denied'
  scope?: ApprovalScope
  decidedAt: number
}

export interface ApprovalService {
  create: (request: ApprovalRequest) => void
  consume: (decision: ApprovalDecision) => ApprovalRequest
  revokeTask: (taskId: string) => void
}

export interface WorkspaceService {
  getGrant: (workspaceId: string) => WorkspaceGrant | undefined
  resolveReadablePath: (workspaceId: string, relativePath: string) => Promise<string>
  applyApprovedPatch: (
    workspaceId: string,
    patchId: string,
    approval: ApprovalDecision
  ) => Promise<void>
}

export interface ExecutionRequest {
  taskId: string
  callId: string
  workspace: WorkspaceGrant
  executable: string
  args: string[]
  timeoutMs: number
}

export interface ExecutionResult {
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  truncated: boolean
}

export interface ExecutionBackend {
  readonly environment: ExecutionEnvironment
  run: (request: ExecutionRequest, signal: AbortSignal) => Promise<ExecutionResult>
  stopTask: (taskId: string) => Promise<void>
}

export type TaskEventType =
  | 'task.created'
  | 'task.status-changed'
  | 'task.output'
  | 'tool.requested'
  | 'tool.completed'
  | 'approval.required'
  | 'task.notice'

export interface TaskEvent<TPayload = unknown> {
  taskId: string
  sessionId: string
  sequence: number
  type: TaskEventType
  timestamp: number
  payload: TPayload
}

export interface TaskSnapshot {
  id: string
  sessionId: string
  workspaceId: string
  permissionMode: PermissionMode
  environment: ExecutionEnvironment
  status: TaskStatus
  sequence: number
  createdAt: number
  updatedAt: number
}

export interface AuditEvent {
  id: string
  timestamp: number
  taskId: string
  workspaceId: string
  actor: 'user' | 'model' | 'policy' | 'system'
  action: string
  outcome: 'allow' | 'ask' | 'deny' | 'success' | 'failure' | 'cancelled'
  risk?: RiskLevel
  reasonCode?: string
  target?: string
  metadata?: Record<string, unknown>
}
