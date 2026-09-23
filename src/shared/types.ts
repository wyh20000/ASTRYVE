/**
 * 主进程 / 预加载 / 渲染进程共享的类型定义。
 * 单一来源（single source of truth）：任何跨层数据结构都在此声明。
 */
import type {
  ActivateWorkspaceInput,
  AuditEvent,
  ExecutionEnvironment,
  ApprovalScope,
  PermissionMode,
  WorkspaceFileContent,
  WorkspaceFileEntry,
  WorkspaceFileSearchInput,
  WorkspaceListInput,
  WorkspaceReadInput,
  WorkspaceReadManyInput,
  WorkspaceSearchInput,
  WorkspaceSaveInput,
  WorkspaceSearchMatch,
  WorkspaceSummary
} from './agent'

export interface AgentProjectPreferences {
  workspaceId: string
  permissionMode: PermissionMode
  executionEnvironment: ExecutionEnvironment
  /** Immutable local image id selected by the user. Never supplied by the model. */
  dockerImageId?: string
}

export interface PluginPreferences { autoUpdate: boolean }

export interface AgentExecutionCapabilities {
  dockerAvailable: boolean
  dockerReason?: string
  dockerPreflight?: DockerPreflightStatus
  dockerImages?: DockerImageOption[]
  localAvailable: boolean
}

export interface DockerImageOption {
  imageId: string
  repository: string
  tag: string
  digest?: string
  source: 'local'
}

export interface DockerPreflightStatus {
  checkedAt: number
  cliFound: boolean
  clientVersion?: string
  contextName?: string
  localContext: boolean
  daemonReachable: boolean
  serverVersion?: string
  operatingSystem?: string
  linuxContainers: boolean
  diskChecked: boolean
  diskSummary?: string
  imageReference: string
  imagePresent: boolean
  imageDigest?: string
  images: DockerImageOption[]
  ready: boolean
  reason: string
}

export interface AgentProjectSettings {
  preferences: AgentProjectPreferences
  capabilities: AgentExecutionCapabilities
}

/** IPC 统一返回结构（不裸抛异常） */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

/** 会话 */
export interface Session {
  id: string
  title: string
  projectPath?: string | null
  pinned: boolean
  createdAt: number // epoch ms
  updatedAt: number // epoch ms
}

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/** 消息状态 */
export type MessageStatus = 'pending' | 'waiting' | 'streaming' | 'done' | 'error' | 'cancelled' | 'interrupted'

/** 一次生成结束的原因；用于恢复中断状态以及避免旧事件覆盖新终态。 */
export type GenerationFinishReason =
  | 'completed'
  | 'error'
  | 'user_cancelled'
  | 'replaced'
  | 'window_closed'
  | 'session_deleted'
  | 'workspace_switched'
  | 'app_quit'
  | 'app_restarted'
  | 'setup_error'

/** 结构化消息块（用于呈现思考态 / 执行计划 / 文件列表等） */
export type MessageBlock =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string; done?: boolean }
  | { kind: 'plan'; items: PlanItem[] }
  | { kind: 'files'; files: GeneratedFile[] }
  | { kind: 'code'; language: string; code: string; filename?: string }
  | { kind: 'sources'; sources: SourceCitation[] }
  | { kind: 'image'; attachmentId: string; title?: string }
  | { kind: 'toolContext'; toolName: string; content: string }
  | { kind: 'skills'; skills: Array<{ name: string; displayName: string; source: SkillSource; version?: string }>; trigger?: string }
  | { kind: 'plugins'; plugins: Array<{ id: string; version?: string }>; model: string }
  | PatchDiffBlock
  | CommandOutputBlock
  | TaskReportBlock

export interface PatchDiffFile {
  path: string
  previousPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  linesAdded: number
  linesDeleted: number
  diff: string
  originalContent?: string
  modifiedContent?: string
}

export interface PatchDiffBlock {
  kind: 'diff'
  taskId: string
  patchHash: string
  files: PatchDiffFile[]
  linesAdded: number
  linesDeleted: number
}

export interface RejectPatchFileInput {
  taskId: string
  patchHash: string
  path: string
}

export interface CommandOutputBlock {
  kind: 'command'
  callId: string
  executable: string
  args: string[]
  exitCode: number | null
  durationMs: number
  truncated: boolean
  stdout: string
  stderr: string
}

export interface TerminalSessionInfo { id: string; workspaceId: string; shell: string }
export interface TerminalOutput { terminalId: string; stream: 'stdout' | 'stderr'; text: string }

export interface TaskReportBlock {
  kind: 'report'
  files: Array<{ path: string; status: PatchDiffFile['status'] }>
  commands: Array<{ command: string; exitCode: number | null; durationMs: number }>
  tests: Array<{ command: string; passed: boolean }>
  approvals: Array<{ toolName: string; target: string }>
  unresolved: string[]
}

export interface PlanItem {
  order: number
  title: string
  done: boolean
}

export interface GeneratedFile {
  path: string
  addedLines: number
}

export interface SourceCitation {
  title: string
  url: string
}

/** 消息 */
export interface TurnEnvelope {
  id: string
  sessionId: string
  createdAt: number
  text: string
  imageRefs: string[]
  documentRefs: string[]
  skillIds: string[]
  pluginIds: string[]
  searchRequested?: boolean
}

export interface Message {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  blocks?: MessageBlock[]
  attachments?: Attachment[]
  status: MessageStatus
  timestamp: number
  generationId?: string
  revision?: number
  finishReason?: GenerationFinishReason
  /** 用户发送时一次性固定的输入来源，后续生成不会改写。 */
  turn?: TurnEnvelope
}

export interface MessageCursor { timestamp: number; id: string }

/** 主进程异步回复过程中产生的非对话区提示 */
export interface MessageNotice {
  id: string
  sessionId: string
  message: string
  level: 'warning' | 'error'
}

/** 附件（为 P3 识图预留） */
export interface Attachment {
  id: string
  kind: 'image' | 'file' | 'url'
  name: string
  contentType: string
  dataRef: string
  meta?: Record<string, unknown>
}

/** 新建会话入参 */
export interface CreateSessionInput {
  title?: string
  projectPath?: string | null
}

/** 发送消息入参（P1 由本地 Mock 消费） */
export interface SendMessageInput {
  /** 渲染进程为一次发送生成的稳定 UUID，也用作幂等键和生成关联 ID。 */
  clientMessageId: string
  sessionId: string
  content: string
  attachments?: Attachment[]
  /** 本轮明确选择供应商联网搜索；默认不联网。 */
  search?: boolean
  skillIds?: string[]
  pluginIds?: string[]
}

export interface UserInputOption {
  label: string
  description?: string
  recommended?: boolean
}

export interface UserInputQuestion {
  id: string
  header?: string
  question: string
  options?: UserInputOption[]
}

export interface UserInputRequest {
  id: string
  sessionId: string
  questions: UserInputQuestion[]
}

export interface UserInputResponse {
  requestId: string
  sessionId: string
  answers: Record<string, string>
}

export interface ApprovalUiRequest {
  id: string
  sessionId: string
  toolName: string
  plugin?: { id: string; version?: string }
  callId: string
  permissionBasis: string
  title: string
  summary: string
  workspace: string
  environment: 'Docker 沙箱' | '本机执行'
  operation: string
  risk: '低风险' | '中等风险' | '高风险' | '严重风险'
  target: string
  details?: string
  detailsTruncated?: boolean
  scopeOptions: ApprovalScope[]
  expiresAt: number
}

export interface ApprovalUiResponse {
  requestId: string
  scope?: ApprovalScope
}

export type SkillSource = 'builtin' | 'installed' | 'codex' | 'agents' | 'plugin' | 'project'

export type SkillInstallKind = 'builtin' | 'github' | 'local' | 'external'

export interface SkillMetadata {
  id: string
  name: string
  displayName: string
  description: string
  source: SkillSource
  enabled: boolean
  active: boolean
  autoTrigger: boolean
  requestedTools: string[]
  allowedTools: string[]
  resources: string[]
  invocation: 'user' | 'model'
  toolPolicy: 'inherit' | 'declared'
  installKind: SkillInstallKind
  repository?: string
  installUrl?: string
  version?: string
  license?: string
  pluginId?: string
  updateAvailable?: boolean
  errors: string[]
  shadowedBy?: string
}

export interface SkillListInput { workspaceId?: string }
export interface SkillToggleInput { id: string; enabled: boolean; workspaceId?: string }
export interface SkillCatalogInput { query?: string }
export interface SkillCatalogItem {
  id: string
  name: string
  displayName: string
  description: string
  repository: string
  installUrl: string
  publisher: string
  featured: boolean
  installed: boolean
}
export interface SkillInstallInput { url: string; workspaceId?: string }
export interface SkillUninstallInput { id: string; workspaceId?: string }

export type PluginPermission =
  | 'workspace.read'
  | 'workspace.write'
  | 'network'
  | 'process'
  | 'browser.read'
  | 'browser.interact'

export type PluginComponent = 'skills' | 'hooks' | 'mcp' | 'tools' | 'ui'
export type PluginStatus = 'ready' | 'invalid' | 'quarantined'
export type PluginMcpAuthKind = 'none' | 'api-key' | 'oauth2'
export interface PluginMcpServerDeclaration {
  id: string
  url: string
  transport: 'streamable-http'
  auth: PluginMcpAuthKind
  apiKeyHeader?: 'Authorization' | 'X-API-Key'
  oauthClientId?: string
  oauthScopes?: string[]
}
export type PluginMcpConnectionState = 'pending' | 'connected' | 'failed' | 'restricted'
export interface PluginMcpConnection {
  id: string
  serverOrigin: string
  serverUrl: string
  auth: PluginMcpAuthKind
  state: PluginMcpConnectionState
  accountLabel?: string
  lastConnectedAt?: number
  errorCode?: string
}
export interface PluginMcpBinding {
  pluginId: string
  serverId: string
  connectionId: string
}
export interface PluginMcpConnectionSummary {
  id: string
  serverOrigin: string
  auth: PluginMcpAuthKind
  state: PluginMcpConnectionState
  accountLabel?: string
  lastConnectedAt?: number
  errorCode?: string
}
export interface PluginMcpServerView {
  id: string
  serverOrigin: string
  auth: PluginMcpAuthKind
  state: PluginMcpConnectionState
  connectionId?: string
  accountLabel?: string
  lastConnectedAt?: number
  errorCode?: string
  compatibleConnections: PluginMcpConnectionSummary[]
}
export interface PluginMcpPluginView {
  pluginId: string
  pluginName: string
  enabled: boolean
  restricted: boolean
  servers: PluginMcpServerView[]
}
export interface PluginMcpConnectInput {
  pluginId: string
  serverId: string
  connectionId?: string
  credential?: string
  accountLabel?: string
}
export interface PluginMcpTargetInput { pluginId: string; serverId: string }
export interface PluginMcpDisconnectInput { connectionId: string }
export type PluginInstallSourceKind = PluginMarketSourceKind | 'local'
export interface PluginInstallOrigin {
  pluginVersion?: string
  sourceId: string
  sourceName: string
  sourceKind: PluginInstallSourceKind
  verified: boolean
  publisherId?: string
}

export interface PluginMetadata {
  id: string
  name: string
  version?: string
  description: string
  author?: string
  source: 'installed'
  sourceFormat: 'native' | 'codex'
  enabled: boolean
  status: PluginStatus
  permissions: PluginPermission[]
  capabilities: string[]
  /** Host resources or user data scopes declared by the plugin package. */
  dataTargets?: string[]
  components: PluginComponent[]
  /** Relative image path declared by the package; the renderer cannot read it directly. */
  iconPath?: string
  errors: string[]
  installOrigin?: PluginInstallOrigin
  /** Read-only application deployment policy; managed plugins remain disableable. */
  managed?: boolean
}

export interface PluginToggleInput { id: string; enabled: boolean }
export interface PluginRecoverInput { id: string }
export type PluginImportKind = 'directory' | 'zip'
export interface PluginImportInput { kind: PluginImportKind }

export type PluginMarketSourceKind = 'official' | 'community' | 'github'
export interface PluginMarketSource {
  id: string
  name: string
  kind: PluginMarketSourceKind
  url: string
  enabled: boolean
  verified: boolean
  lastSyncAt?: number
  error?: string
  signingKeyId?: string
  signingPublicKey?: string
  /** Version of locally derived presentation metadata such as official icon URLs. */
  presentationVersion?: number
}
export interface PluginMarketEntry {
  id: string
  name: string
  version: string
  description: string
  author: string
  sourceId: string
  sourceName: string
  sourceKind: PluginMarketSourceKind
  verified: boolean
  packageUrl?: string
  sha256?: string
  signature?: string
  signingKeyId?: string
  signingPublicKey?: string
  publisherId?: string
  permissions: PluginPermission[]
  categories: string[]
  recommended?: boolean
  changelog?: string
  minAppVersion?: string
  platforms: string[]
  architectures: string[]
  capabilities?: string[]
  components?: PluginComponent[]
  dataTargets?: string[]
  installable?: boolean
  unavailableReason?: string
  /** Codex official manifest presentation metadata. Remote assets are accepted only from the pinned official repository. */
  brandColor?: string
  composerIconUrl?: string
  logoUrl?: string
  logoDarkUrl?: string
  repository?: {
    owner: string
    repo: string
    ref: string
    path: string
  }
}
export interface PluginMarketplaceSnapshot {
  sources: PluginMarketSource[]
  entries: PluginMarketEntry[]
}
export interface PluginMarketSourceInput { name: string; url: string; signingKeyId?: string; signingPublicKey?: string }
export interface PluginMarketSourceIdInput { id: string }
export interface PluginMarketSourceToggleInput { id: string; enabled: boolean }
export interface PluginMarketInstallInput { sourceId: string; id: string; version: string }
export interface PluginUninstallInput { id: string; dataDisposition?: 'keep' | 'clear' }
export interface PluginBackup { pluginId: string; version: string; createdAt: number }
export interface PluginRollbackInput { id: string; version: string }
export interface BrowserPreferences { allowAllSites: boolean; allowedOrigins: string[]; blockedOrigins: string[] }

/** 模型提供方（DeepSeek / Kimi / 自定义 OpenAI 兼容） */
export type ModelProvider = 'deepseek' | 'kimi' | 'custom'

/** 推理强度档位 */
export type ReasoningEffort = 'low' | 'medium' | 'high'

/** 单个模型预设（一个可切换的模型端点） */
export interface ModelPreset {
  id: string
  name: string
  provider: ModelProvider
  baseUrl: string
  apiKey: string
  /** 仅供渲染进程显示密钥状态；主进程返回配置时 apiKey 始终为空。 */
  hasApiKey?: boolean
  model: string
  /** 显式能力声明；自定义兼容端点无法可靠地从模型名推断。 */
  capabilities?: { imageInput: boolean; nativeToolCalling?: boolean }
  /** 发送给模型的上下文消息条数（多轮记忆长度） */
  contextMessages: number
  /** 单次请求可使用的上下文预算（近似 token，已预留输出空间）。 */
  contextTokens?: number
}

/** 模型配置（含多预设、当前激活项、推理等级） */
export interface ModelConfig {
  presets: ModelPreset[]
  activePresetId: string
  reasoningEffort: ReasoningEffort
}

/** 模型连通性测试结果 */
export interface ModelTestResult {
  success: boolean
  message: string
}

/**
 * 主题颜色覆盖与持久化结构统一由 shared/themePreferences 提供，
 * 这里既转出类型，也把类型引入本地作用域，
 * 因为文件下方（IPC 契约）还需要直接引用 PersistedTheme。
 */
import type { ThemeMode, ThemeOverrides, PersistedTheme } from './themePreferences'
export type { ThemeMode, ThemeOverrides, PersistedTheme }
export {
  DEFAULT_THEME_MODE,
  DEFAULT_UI_FONT_SIZE,
  THEME_SCHEMA_VERSION,
  isThemeMode,
  resolveThemeSettings,
  sanitizeThemeOverrides
} from './themePreferences'

/** 数据库连接配置 */
export interface DbConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
}

/** 前端可通过 window.agent 访问的统一 API 面 */
export interface AuthStatus {
  mode: 'local' | 'remote'
  state: 'authenticated' | 'signedOut' | 'waiting' | 'offline' | 'unconfigured'
  userId?: string
  message?: string
}

export interface AgentApi {
  platform: string
  auth: {
    status: () => Promise<IpcResult<AuthStatus>>
    start: () => Promise<IpcResult<AuthStatus>>
    cancel: () => Promise<IpcResult<AuthStatus>>
    logout: () => Promise<IpcResult<{ revocationPending: boolean }>>
    link: () => Promise<IpcResult<{ opened: boolean }>>
  }
  ping: () => Promise<IpcResult<string>>
  session: {
    list: () => Promise<IpcResult<Session[]>>
    create: (input: CreateSessionInput) => Promise<IpcResult<Session>>
    rename: (id: string, title: string) => Promise<IpcResult<Session>>
    remove: (id: string) => Promise<IpcResult<{ id: string }>>
    touch: (id: string) => Promise<IpcResult<Session>>
  }
  message: {
    list: (sessionId: string, before?: MessageCursor) => Promise<IpcResult<Message[]>>
    send: (input: SendMessageInput) => Promise<IpcResult<Message>>
    stop: (sessionId: string) => Promise<IpcResult<{ stopped: boolean }>>
    respondInput: (input: UserInputResponse) => Promise<IpcResult<{ accepted: boolean }>>
  }
  approval: {
    respond: (input: ApprovalUiResponse) => Promise<IpcResult<{ accepted: boolean }>>
  }
  workspace: {
    listRecent: () => Promise<IpcResult<WorkspaceSummary[]>>
    select: () => Promise<IpcResult<WorkspaceSummary | null>>
    activate: (
      input: ActivateWorkspaceInput
    ) => Promise<IpcResult<{ workspace: WorkspaceSummary; session: Session }>>
    listFiles: (input: WorkspaceListInput) => Promise<IpcResult<WorkspaceFileEntry[]>>
    findFiles: (input: WorkspaceFileSearchInput) => Promise<IpcResult<WorkspaceFileEntry[]>>
    readFile: (input: WorkspaceReadInput) => Promise<IpcResult<WorkspaceFileContent>>
    saveFile: (input: WorkspaceSaveInput) => Promise<IpcResult<WorkspaceFileContent>>
    readMany: (input: WorkspaceReadManyInput) => Promise<IpcResult<WorkspaceFileContent[]>>
    searchText: (input: WorkspaceSearchInput) => Promise<IpcResult<WorkspaceSearchMatch[]>>
    rejectPatchFile: (input: RejectPatchFileInput) => Promise<IpcResult<PatchDiffBlock>>
  }
  terminal: {
    open: (sessionId: string) => Promise<IpcResult<TerminalSessionInfo>>
    write: (terminalId: string, text: string) => Promise<IpcResult<{ written: boolean }>>
    close: (terminalId: string) => Promise<IpcResult<{ closed: boolean }>>
  }
  model: {
    getConfig: () => Promise<IpcResult<ModelConfig>>
    setConfig: (cfg: Partial<ModelConfig>) => Promise<IpcResult<ModelConfig>>
    setActive: (id: string) => Promise<IpcResult<ModelConfig>>
    setReasoning: (effort: ReasoningEffort) => Promise<IpcResult<ModelConfig>>
    test: (preset?: ModelPreset) => Promise<IpcResult<ModelTestResult>>
  }
  onMessageStreamed: (cb: (m: Message) => void) => () => void
  onMessageNotice: (cb: (notice: MessageNotice) => void) => () => void
  onUserInputRequested: (cb: (request: UserInputRequest) => void) => () => void
  onUserInputResolved: (cb: (request: Pick<UserInputRequest, 'id' | 'sessionId'>) => void) => () => void
  onApprovalRequested: (cb: (request: ApprovalUiRequest) => void) => () => void
  onApprovalResolved: (cb: (request: Pick<ApprovalUiRequest, 'id' | 'sessionId'>) => void) => () => void
  onTerminalOutput: (cb: (output: TerminalOutput) => void) => () => void
  onWorkspaceFilesChanged: (cb: (change: WorkspaceFilesChanged) => void) => () => void
  onPluginsChanged: (cb: () => void) => () => void
  skills: {
    list: (input: SkillListInput) => Promise<IpcResult<SkillMetadata[]>>
    catalog: (input?: SkillCatalogInput) => Promise<IpcResult<SkillCatalogItem[]>>
    install: (input: SkillInstallInput) => Promise<IpcResult<SkillMetadata[]>>
    importLocal: (input: SkillListInput) => Promise<IpcResult<SkillMetadata[]>>
    uninstall: (input: SkillUninstallInput) => Promise<IpcResult<SkillMetadata[]>>
    setEnabled: (input: SkillToggleInput) => Promise<IpcResult<SkillMetadata[]>>
  }
  plugins: {
    list: () => Promise<IpcResult<PluginMetadata[]>>
    readIcon: (input: { id: string }) => Promise<IpcResult<string | undefined>>
    readAsset: (input: { id: string; path: string }) => Promise<IpcResult<string>>
    openUi: (input: { id: string }) => Promise<IpcResult<void>>
    listSkills: (input: PluginUninstallInput) => Promise<IpcResult<SkillMetadata[]>>
    importLocal: (input: PluginImportInput) => Promise<IpcResult<PluginMetadata[]>>
    setEnabled: (input: PluginToggleInput) => Promise<IpcResult<PluginMetadata[]>>
    recover: (input: PluginRecoverInput) => Promise<IpcResult<PluginMetadata[]>>
    marketplace: () => Promise<IpcResult<PluginMarketplaceSnapshot>>
    addSource: (input: PluginMarketSourceInput) => Promise<IpcResult<PluginMarketplaceSnapshot>>
    setSourceEnabled: (input: PluginMarketSourceToggleInput) => Promise<IpcResult<PluginMarketplaceSnapshot>>
    removeSource: (input: PluginMarketSourceIdInput) => Promise<IpcResult<PluginMarketplaceSnapshot>>
    syncSource: (input: PluginMarketSourceIdInput) => Promise<IpcResult<PluginMarketplaceSnapshot>>
    installMarket: (input: PluginMarketInstallInput) => Promise<IpcResult<PluginMetadata[]>>
    uninstall: (input: PluginUninstallInput) => Promise<IpcResult<PluginMetadata[]>>
    backups: (input: PluginUninstallInput) => Promise<IpcResult<PluginBackup[]>>
    rollback: (input: PluginRollbackInput) => Promise<IpcResult<PluginMetadata[]>>
    getPreferences: () => Promise<IpcResult<PluginPreferences>>
    setPreferences: (input: PluginPreferences) => Promise<IpcResult<PluginPreferences>>
    listConnections: () => Promise<IpcResult<PluginMcpPluginView[]>>
    connectMcp: (input: PluginMcpConnectInput) => Promise<IpcResult<PluginMcpPluginView[]>>
    reauthorizeMcp: (input: PluginMcpConnectInput) => Promise<IpcResult<PluginMcpPluginView[]>>
    retryMcp: (input: PluginMcpTargetInput) => Promise<IpcResult<PluginMcpPluginView[]>>
    disconnectMcp: (input: PluginMcpDisconnectInput) => Promise<IpcResult<PluginMcpPluginView[]>>
  }
  settings: {
    getTheme: () => Promise<IpcResult<PersistedTheme>>
    setTheme: (t: PersistedTheme) => Promise<IpcResult<PersistedTheme>>
    getAgentProject: (workspaceId: string) => Promise<IpcResult<AgentProjectSettings>>
    setAgentProject: (
      preferences: AgentProjectPreferences
    ) => Promise<IpcResult<AgentProjectSettings>>
    clearAudit: () => Promise<IpcResult<{ cleared: boolean }>>
    getAudit: () => Promise<IpcResult<AuditEvent[]>>
    getBrowserPreferences: () => Promise<IpcResult<BrowserPreferences>>
    setBrowserPreferences: (value: BrowserPreferences) => Promise<IpcResult<BrowserPreferences>>
  }
  window: {
    setTitleBarOverlay: (opts?: { color: string; symbolColor: string }) => Promise<IpcResult<boolean>>
  }
}

export interface WorkspaceFilesChanged {
  workspaceId: string
  paths: string[]
}
