import { randomUUID } from 'crypto'
import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import type { ModelConfig, ModelPreset, ModelProvider, ReasoningEffort } from '@shared/types'

/** 各提供方的默认 baseUrl / model / 视觉能力 */
export const PROVIDER_PRESETS: Record<
  ModelProvider,
  { baseUrl: string; model: string; supportsVision: boolean; visionModel?: string }
> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    supportsVision: true,
    visionModel: 'deepseek-v4-flash-vision-exp'
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    supportsVision: true,
    visionModel: 'moonshot-v1-8k-vision-preview'
  },
  custom: { baseUrl: '', model: '', supportsVision: false }
}

function envProvider(): ModelProvider {
  const p = (process.env.MODEL_PROVIDER ?? 'deepseek') as ModelProvider
  return p === 'kimi' || p === 'deepseek' || p === 'custom' ? p : 'deepseek'
}

function makeDefaultPreset(): ModelPreset {
  const provider = envProvider()
  const preset = PROVIDER_PRESETS[provider]
  return {
    id: randomUUID(),
    name: provider === 'kimi' ? 'Kimi' : provider === 'deepseek' ? 'DeepSeek' : '自定义',
    provider,
    baseUrl: process.env.MODEL_BASE_URL ?? preset.baseUrl,
    apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.MOONSHOT_API_KEY ?? process.env.MODEL_API_KEY ?? '',
    model: process.env.MODEL ?? preset.model,
    contextMessages: Number(process.env.CONTEXT_MESSAGES ?? 20) || 20,
    supportsVision: preset.supportsVision,
    visionModel: preset.visionModel
  }
}

function defaults(): ModelConfig {
  const p = makeDefaultPreset()
  return { presets: [p], activePresetId: p.id, reasoningEffort: 'medium' }
}

let config: ModelConfig = defaults()

function configFile(): string {
  return join(app.getPath('userData'), 'ai-agent-config.json')
}

/** 规范化一个预设：补齐 supportsVision / visionModel 等缺省字段（兼容旧配置） */
export function normalizePreset(p: Partial<ModelPreset>): ModelPreset {
  const provider = (p.provider as ModelProvider) ?? 'deepseek'
  const def = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.custom
  return {
    id: p.id ?? randomUUID(),
    name: p.name || (provider === 'kimi' ? 'Kimi' : provider === 'deepseek' ? 'DeepSeek' : '自定义'),
    provider,
    baseUrl: p.baseUrl ?? '',
    apiKey: p.apiKey ?? '',
    model: p.model ?? '',
    contextMessages: Number(p.contextMessages) || 20,
    supportsVision: p.supportsVision ?? def.supportsVision,
    visionModel: p.visionModel ?? def.visionModel
  }
}

/** 迁移旧的扁平配置 → 多预设结构 */
export function migrate(saved: Record<string, unknown>): ModelConfig {
  if (Array.isArray(saved.presets) && (saved.presets as ModelPreset[]).length > 0) {
    const presets = (saved.presets as Partial<ModelPreset>[]).map(normalizePreset)
    return {
      presets,
      activePresetId: (saved.activePresetId as string) ?? presets[0].id,
      reasoningEffort: (saved.reasoningEffort as ReasoningEffort) ?? 'medium'
    }
  }
  // 旧结构：{ provider, baseUrl, apiKey, model, contextMessages }
  const provider = (saved.provider as ModelProvider) ?? envProvider()
  const presets: ModelPreset[] = []
  if (saved.baseUrl || saved.apiKey || saved.model) {
    presets.push(
      normalizePreset({
        provider,
        baseUrl: (saved.baseUrl as string) ?? '',
        apiKey: (saved.apiKey as string) ?? '',
        model: (saved.model as string) ?? '',
        contextMessages: Number(saved.contextMessages) || 20
      })
    )
  }
  if (presets.length === 0) return defaults()
  return { presets, activePresetId: presets[0].id, reasoningEffort: 'medium' }
}

export function initModelConfig(): ModelConfig {
  config = defaults()
  try {
    if (fs.existsSync(configFile())) {
      const raw = fs.readFileSync(configFile(), 'utf-8')
      config = migrate(JSON.parse(raw))
    }
  } catch (e) {
    console.warn('[model] failed to load config:', e)
  }
  return config
}

export function getModelConfig(): ModelConfig {
  return config
}

export function getActivePreset(): ModelPreset | null {
  return config.presets.find((p) => p.id === config.activePresetId) ?? config.presets[0] ?? null
}

export function setModelConfig(cfg: Partial<ModelConfig>): ModelConfig {
  config = { ...config, ...cfg }
  if (!config.presets.some((p) => p.id === config.activePresetId)) {
    config.activePresetId = config.presets[0]?.id ?? ''
  }
  persist()
  return config
}

export function setActivePreset(id: string): ModelConfig {
  if (config.presets.some((p) => p.id === id)) config.activePresetId = id
  persist()
  return config
}

export function setReasoningEffort(effort: ReasoningEffort): ModelConfig {
  if (effort === 'low' || effort === 'medium' || effort === 'high') config.reasoningEffort = effort
  persist()
  return config
}

function persist(): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[model] failed to save config:', e)
  }
}
