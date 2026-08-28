import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import type { ModelConfig, ModelProvider } from '@shared/types'

/** 各提供方的默认 baseUrl / model */
export const PROVIDER_PRESETS: Record<ModelProvider, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  custom: { baseUrl: '', model: '' }
}

function envProvider(): ModelProvider {
  const p = (process.env.MODEL_PROVIDER ?? 'deepseek') as ModelProvider
  return p === 'kimi' || p === 'deepseek' || p === 'custom' ? p : 'deepseek'
}

function defaults(): ModelConfig {
  const provider = envProvider()
  const preset = PROVIDER_PRESETS[provider]
  return {
    provider,
    baseUrl: process.env.MODEL_BASE_URL ?? preset.baseUrl,
    apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.MOONSHOT_API_KEY ?? process.env.MODEL_API_KEY ?? '',
    model: process.env.MODEL ?? preset.model,
    contextMessages: Number(process.env.CONTEXT_MESSAGES ?? 20) || 20
  }
}

let config: ModelConfig = defaults()

function configFile(): string {
  return join(app.getPath('userData'), 'ai-agent-config.json')
}

export function initModelConfig(): ModelConfig {
  config = defaults()
  try {
    if (fs.existsSync(configFile())) {
      const raw = fs.readFileSync(configFile(), 'utf-8')
      const saved = JSON.parse(raw) as Partial<ModelConfig>
      // 用保存的配置覆盖未显式通过环境变量设置的项
      if (saved.provider) config.provider = saved.provider
      if (saved.baseUrl) config.baseUrl = saved.baseUrl
      if (saved.apiKey) config.apiKey = saved.apiKey
      if (saved.model) config.model = saved.model
      if (saved.contextMessages) config.contextMessages = saved.contextMessages
    }
  } catch (e) {
    console.warn('[model] failed to load config:', e)
  }
  return config
}

export function getModelConfig(): ModelConfig {
  return config
}

export function setModelConfig(cfg: Partial<ModelConfig>): ModelConfig {
  config = { ...config, ...cfg }
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[model] failed to save config:', e)
  }
  return config
}