/**
 * 主进程 / 预加载 / 渲染进程共享的类型定义。
 * 单一来源（single source of truth）：任何跨层数据结构都在此声明。
 */

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
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error'

/** 结构化消息块（用于呈现思考态 / 执行计划 / 文件列表等） */
export type MessageBlock =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string; seconds?: number }
  | { kind: 'plan'; items: PlanItem[] }
  | { kind: 'files'; files: GeneratedFile[] }
  | { kind: 'code'; language: string; code: string; filename?: string }

export interface PlanItem {
  order: number
  title: string
  done: boolean
}

export interface GeneratedFile {
  path: string
  addedLines: number
}

/** 消息 */
export interface Message {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  blocks?: MessageBlock[]
  status: MessageStatus
  timestamp: number
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
  sessionId: string
  content: string
}

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
  model: string
  /** 发送给模型的上下文消息条数（多轮记忆长度） */
  contextMessages: number
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

/** 前端可通过 window.agent 访问的统一 API 面 */
export interface AgentApi {
  platform: string
  ping: () => Promise<IpcResult<string>>
  session: {
    list: () => Promise<IpcResult<Session[]>>
    create: (input: CreateSessionInput) => Promise<IpcResult<Session>>
    rename: (id: string, title: string) => Promise<IpcResult<Session>>
    remove: (id: string) => Promise<IpcResult<{ id: string }>>
    touch: (id: string) => Promise<IpcResult<Session>>
  }
  message: {
    list: (sessionId: string) => Promise<IpcResult<Message[]>>
    send: (input: SendMessageInput) => Promise<IpcResult<Message>>
  }
  model: {
    getConfig: () => Promise<IpcResult<ModelConfig>>
    setConfig: (cfg: Partial<ModelConfig>) => Promise<IpcResult<ModelConfig>>
    setActive: (id: string) => Promise<IpcResult<ModelConfig>>
    setReasoning: (effort: ReasoningEffort) => Promise<IpcResult<ModelConfig>>
    test: (preset?: ModelPreset) => Promise<IpcResult<ModelTestResult>>
  }
  onMessageStreamed: (cb: (m: Message) => void) => () => void
  window: {
    setTitleBarOverlay: (opts?: { color: string; symbolColor: string }) => Promise<IpcResult<boolean>>
  }
}