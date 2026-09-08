import type { IpcMainInvokeEvent } from 'electron'
import type { Attachment, CreateSessionInput, ModelConfig, ModelPreset, SendMessageInput } from '@shared/types'

const ID_PATTERN = /^[a-f0-9-]{16,64}$/i
const MAX_CONTENT_CHARS = 100_000
const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_ATTACHMENTS_BYTES = 64 * 1024 * 1024

export class InputValidationError extends Error {}

function invalid(message: string): never {
  throw new InputValidationError(message)
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const raw = event.senderFrame?.url || event.sender.getURL()
  try {
    const url = new URL(raw)
    const localDev =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    if (url.protocol === 'file:' || localDev) return
  } catch {
    // fall through
  }
  invalid('IPC 调用来源不受信任')
}

export function validateSessionId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) invalid('会话 ID 无效')
  return value
}

export function validateWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) invalid('工作区 ID 无效')
  return value
}

export function validateWorkspaceRelativePath(value: unknown, allowRoot = false): string {
  if (value == null && allowRoot) return ''
  if (typeof value !== 'string' || value.length > 4096) invalid('工作区路径无效')
  return value
}

export function validateCreateSessionInput(value: unknown): CreateSessionInput {
  if (value == null) return {}
  if (typeof value !== 'object') invalid('会话参数无效')
  const input = value as CreateSessionInput
  if (input.title != null && (typeof input.title !== 'string' || input.title.length > 512)) {
    invalid('会话标题过长')
  }
  if (input.projectPath != null) invalid('项目只能通过受信任的工作区选择器关联')
  return input
}

function dataUrlBytes(dataRef: string): number {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataRef)
  if (!match) invalid('附件数据格式无效')
  return Math.floor((match[2].replace(/[\r\n]/g, '').length * 3) / 4)
}

function validateAttachment(value: unknown): Attachment {
  if (!value || typeof value !== 'object') invalid('附件参数无效')
  const attachment = value as Attachment
  if (attachment.kind !== 'image' && attachment.kind !== 'file') invalid('附件类型无效')
  if (typeof attachment.id !== 'string' || !ID_PATTERN.test(attachment.id)) invalid('附件 ID 无效')
  if (typeof attachment.name !== 'string' || !attachment.name || attachment.name.length > 255) {
    invalid('附件名称无效')
  }
  if (typeof attachment.contentType !== 'string' || attachment.contentType.length > 128) {
    invalid('附件 MIME 类型无效')
  }
  if (attachment.kind === 'image' && !attachment.contentType.startsWith('image/')) {
    invalid('图片 MIME 类型无效')
  }
  if (typeof attachment.dataRef !== 'string') invalid('附件数据无效')
  const size = dataUrlBytes(attachment.dataRef)
  if (size > MAX_ATTACHMENT_BYTES) invalid('单个附件不能超过 25MB')
  return attachment
}

export function validateSendMessageInput(value: unknown): SendMessageInput {
  if (!value || typeof value !== 'object') invalid('消息参数无效')
  const input = value as SendMessageInput
  validateSessionId(input.sessionId)
  if (typeof input.content !== 'string' || input.content.length > MAX_CONTENT_CHARS) {
    invalid('消息内容无效或过长')
  }
  if (input.search != null && typeof input.search !== 'boolean') invalid('联网参数无效')
  if (input.skillIds != null && (!Array.isArray(input.skillIds) || input.skillIds.length > 5 ||
      input.skillIds.some((id) => typeof id !== 'string' || !/^[a-z]+:[a-f0-9]{12}:[a-z0-9_-]{2,64}$/.test(id)))) {
    invalid('Skill 选择无效')
  }
  if (input.attachments != null && !Array.isArray(input.attachments)) invalid('附件列表无效')
  const attachments = (input.attachments ?? []).map(validateAttachment)
  if (attachments.length > MAX_ATTACHMENTS) invalid(`一次最多发送 ${MAX_ATTACHMENTS} 个附件`)
  const total = attachments.reduce((sum, attachment) => sum + dataUrlBytes(attachment.dataRef), 0)
  if (total > MAX_ATTACHMENTS_BYTES) invalid('附件总大小不能超过 64MB')
  if (!input.content.trim() && attachments.length === 0) invalid('消息不能为空')
  return { ...input, content: input.content, attachments, skillIds: input.skillIds ? [...new Set(input.skillIds)] : undefined }
}

function validateModelPreset(value: unknown): ModelPreset {
  if (!value || typeof value !== 'object') invalid('模型预设无效')
  const preset = value as ModelPreset
  if (typeof preset.id !== 'string' || !ID_PATTERN.test(preset.id)) invalid('模型预设 ID 无效')
  if (typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 100) invalid('模型名称无效')
  if (!['deepseek', 'kimi', 'custom'].includes(preset.provider)) invalid('模型提供方无效')
  if (typeof preset.model !== 'string' || preset.model.length > 200) invalid('模型标识无效')
  if (typeof preset.apiKey !== 'string' || preset.apiKey.length > 4096) invalid('API Key 无效')
  if (typeof preset.baseUrl !== 'string' || preset.baseUrl.length > 2048) invalid('Base URL 无效')
  if (preset.baseUrl) {
    let url: URL
    try {
      url = new URL(preset.baseUrl)
    } catch {
      invalid('Base URL 格式无效')
    }
    const localHttp =
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    if (url.protocol !== 'https:' && !localHttp) invalid('Base URL 仅允许 HTTPS 或本机 HTTP')
    if (url.username || url.password) invalid('Base URL 不能包含账号密码')
  }
  if (!Number.isInteger(preset.contextMessages) || preset.contextMessages < 1 || preset.contextMessages > 50) {
    invalid('上下文消息数必须在 1 到 50 之间')
  }
  if (
    preset.contextTokens != null &&
    (!Number.isInteger(preset.contextTokens) || preset.contextTokens < 8_000 || preset.contextTokens > 1_000_000)
  ) {
    invalid('上下文预算必须在 8,000 到 1,000,000 tokens 之间')
  }
  if (preset.capabilities != null && typeof preset.capabilities.imageInput !== 'boolean') {
    invalid('模型能力配置无效')
  }
  return preset
}

export function validateModelConfigPatch(value: unknown): Partial<ModelConfig> {
  if (!value || typeof value !== 'object') invalid('模型配置无效')
  const config = value as Partial<ModelConfig>
  if (config.presets != null) {
    if (!Array.isArray(config.presets) || config.presets.length > 50) invalid('模型预设列表无效')
    config.presets = config.presets.map(validateModelPreset)
  }
  if (config.activePresetId != null && typeof config.activePresetId !== 'string') invalid('当前模型 ID 无效')
  if (config.reasoningEffort != null && !['low', 'medium', 'high'].includes(config.reasoningEffort)) {
    invalid('推理等级无效')
  }
  return config
}

export function validationErrorMessage(error: unknown): string {
  return error instanceof InputValidationError ? error.message : '请求参数无效'
}
