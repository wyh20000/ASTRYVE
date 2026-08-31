import type { ModelPreset, ModelProvider } from './types'

/**
 * OpenAI 兼容接口没有统一的模型能力发现协议，因此只能根据模型标识判断图片能力。
 * 新增多模态模型时应将它作为独立预设保存，并在对话中显式切换到该预设。
 */
const MULTIMODAL_MODEL_PATTERNS = [
  /(^|[-_.])vision($|[-_.])/i,
  /(^|[-_.])vl($|[-_.0-9])/i,
  /^glm-4v(?:$|[-_.])/i,
  /^gpt-(?:4o|4\.1|5)(?:$|[-_.])/i,
  /^gemini(?:$|[-_.])/i,
  /^claude-(?:3|4)(?:$|[-_.])/i,
  /^kimi-k3(?:$|[-_.])/i
]

/** 当前所选模型本身是否支持图片输入；显式配置优先，字符串仅用于旧配置迁移。 */
export function supportsImageInput(
  value: string | Pick<ModelPreset, 'model' | 'capabilities'>
): boolean {
  if (typeof value !== 'string' && value.capabilities) return value.capabilities.imageInput
  const model = typeof value === 'string' ? value : value.model
  const normalized = model.trim()
  return normalized.length > 0 && MULTIMODAL_MODEL_PATTERNS.some((pattern) => pattern.test(normalized))
}

/** 当前提供方是否有已适配的平台内置联网搜索协议。 */
export function supportsBuiltInSearch(provider: ModelProvider | undefined): boolean {
  return provider === 'kimi' || provider === 'deepseek'
}
