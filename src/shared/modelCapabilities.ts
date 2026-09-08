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

/**
 * 所有已配置模型都会获得自动联网入口：DeepSeek / Kimi 使用厂商协议，
 * 自定义 OpenAI 兼容端点尝试 Responses web_search，不支持时由调用层回退普通对话。
 */
export function supportsBuiltInSearch(provider: ModelProvider | undefined): boolean {
  return provider === 'kimi' || provider === 'deepseek' || provider === 'custom'
}

/** 项目会话中，仅把明显的资料查询自动交给联网回答，文件/代码任务继续走 Agent。 */
export function prefersBuiltInSearch(request: string): boolean {
  const text = request.trim()
  if (!text) return false
  const projectAction = /(修改|写入|编辑|实现|修复|重构|提交|运行|构建|测试|代码|文件|项目|diff|patch|commit|build|implement|refactor|fix\b|edit\b|write\b)/i
  if (projectAction.test(text)) return false
  return /(联网|上网|网上|搜索|搜一下|查一下|检索|最新|今天|今日|新闻|价格|行情|天气|官方文档|官网|web\s*search|search\s+(?:the\s+)?web|look\s+up|latest|today|current\s+(?:news|price|weather|version))/i.test(text)
}
