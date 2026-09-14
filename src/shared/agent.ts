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
  'cancelled',
  'stale'
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled', 'stale'] as const
export type TerminalTaskStatus = (typeof TERMINAL_TASK_STATUSES)[number]

export const OPERATION_KINDS = [
  'fs.read',
  'fs.search',
  'fs.patch',
  'fs.apply-host',
  'process.run',
  'process.start',
  'process.stop',
  'network.enable',
  'browser.read',
  'browser.interact',
  'git.read',
  'git.write'
] as const
export type OperationKind = (typeof OPERATION_KINDS)[number]

export type PolicyOutcome = 'allow' | 'ask' | 'deny'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ApprovalScope = 'once' | 'task-prefix' | 'site'

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
  hash: string
}

export interface WorkspaceSaveInput {
  workspaceId: string
  path: string
  content: string
  expectedHash: string
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

export interface WorkspaceFileSearchInput {
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
  permissionMode: PermissionMode
}

export interface ToolResult<TResult = unknown> {
  ok: boolean
  value?: TResult
  error?: { code: string; message: string }
}

/** 可发送给模型的受限 JSON Schema；工具入参首版统一为封闭对象。 */
export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties: false
}

export interface NativeFunctionToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolInputSchema
  }
}

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string
  /** Trusted package provenance captured from a validated plugin manifest. */
  plugin?: { id: string; version?: string }
  operation: OperationKind
  description: string
  parameters: ToolInputSchema
  validateArgs: (input: unknown) => input is TArgs
  /** Optional trusted approval text derived from main-process state, never from model-supplied preview text. */
  approvalSummary?: (input: TArgs, context: ToolExecutionContext) => string | Promise<string>
  execute: (input: TArgs, context: ToolExecutionContext) => Promise<ToolResult<TResult>>
}

export interface ToolExecutionContext {
  taskId: string
  callId: string
  workspace: WorkspaceGrant
  environment: ExecutionEnvironment
  permissionMode: PermissionMode
  dockerImageId?: string
  signal: AbortSignal
}

export interface PolicyContext {
  permissionMode: PermissionMode
  workspace: WorkspaceGrant
  invocation: ToolInvocation
  operation: OperationKind
  target: NormalizedOperationTarget
}

export interface NormalizedCommand {
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
  expectedPorts?: number[]
}

export interface CommandRiskSignals {
  shellSyntax: boolean
  shellInterpreter: boolean
  destructive: boolean
  dependencyChange: boolean
  longRunning: boolean
  credentialAccess: boolean
  projectScript: boolean
  deterministicCheck: boolean
}

export type NormalizedOperationTarget =
  | {
      type: 'file'
      path: string
      outsideWorkspace: boolean
      sensitive: boolean
      destructive: boolean
      binary: boolean
    }
  | {
      type: 'command'
      command: NormalizedCommand
      signals: CommandRiskSignals
      commandPrefix: string[]
    }
  | {
      type: 'network'
      protocol: 'http:' | 'https:' | 'other'
      host: string
      scope: 'once' | 'task'
    }
  | {
      type: 'service-stop'
      serviceId: string
    }
  | {
      type: 'git'
      action: string
      write: boolean
    }
  | {
      type: 'host-patch'
      paths: string[]
      patchHash: string
      outsideWorkspace: boolean
    }
  | {
      type: 'browser'
      action: string
      origin: string
      tabId?: string
      write: boolean
      sensitive: boolean
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
  /** Trusted registry name, never supplied by model-generated preview content. */
  toolName: string
  plugin?: { id: string; version?: string }
  workspaceId: string
  environment: ExecutionEnvironment
  operation: OperationKind
  permissionMode: PermissionMode
  policyReasonCode: string
  normalizedTarget: string
  bindingHash: string
  commandPrefix?: string[]
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

export interface ApprovalGrant {
  token: string
  requestId: string
  scope: ApprovalScope
  expiresAt: number
}

export interface ApprovalBinding {
  taskId: string
  callId: string
  toolName: string
  plugin?: { id: string; version?: string }
  workspaceId: string
  environment: ExecutionEnvironment
  operation: OperationKind
  permissionMode: PermissionMode
  policyReasonCode: string
  normalizedTarget: string
  commandPrefix?: string[]
}

export interface ApprovalService {
  create: (request: ApprovalRequest) => void
  decide: (decision: ApprovalDecision) => ApprovalGrant | undefined
  consume: (token: string, binding: ApprovalBinding) => ApprovalRequest
  isTaskPrefixApproved: (binding: ApprovalBinding) => boolean
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
  /** Trusted immutable image id captured when the task was created. */
  dockerImageId?: string
  /** Trusted host tools may suppress raw output events and return only a sanitized result. */
  captureOnly?: boolean
}

export interface ExecutionResult {
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  truncated: boolean
  sandboxChanges?: SandboxChangeManifest
}

export interface SandboxFileChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
  beforeHash?: string
  afterHash?: string
  size?: number
  diff?: string
}

export interface SandboxChangeManifest {
  files: SandboxFileChange[]
  added: number
  modified: number
  deleted: number
  truncated: boolean
}

export interface ExecutionServiceRequest extends ExecutionRequest {
  expectedPorts?: number[]
}

export interface ExecutionServiceInfo {
  serviceId: string
  pid: number
  expectedPorts: number[]
  startedAt: number
}

export interface ExecutionBackend {
  readonly environment: ExecutionEnvironment
  run: (request: ExecutionRequest, signal: AbortSignal) => Promise<ExecutionResult>
  stopTask: (taskId: string) => Promise<void>
}

export interface ServiceExecutionBackend extends ExecutionBackend {
  startService: (
    request: ExecutionServiceRequest,
    signal: AbortSignal
  ) => Promise<ExecutionServiceInfo>
  stopService: (taskId: string, serviceId: string) => Promise<boolean>
}

export type TaskEventType =
  | 'task.created'
  | 'task.status-changed'
  | 'task.output'
  | 'tool.requested'
  | 'tool.completed'
  | 'approval.required'
  | 'task.notice'

export type TaskOutputStream = 'model' | 'reasoning' | 'stdout' | 'stderr'

export interface TaskOutputPayload {
  stream: TaskOutputStream
  chunk: string
}

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
  ownerWebContentsId: number
  permissionMode: PermissionMode
  environment: ExecutionEnvironment
  dockerImageId?: string
  /** Frozen plugin set captured when the task was created. */
  pluginIds?: string[]
  pluginVersions?: Record<string, string | undefined>
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
  /** Explicit allowlisted evidence. Arbitrary metadata is never persisted. */
  toolName?: string
  pluginId?: string
  pluginVersion?: string
  approvalScope?: ApprovalScope
  metadata?: Record<string, unknown>
}
