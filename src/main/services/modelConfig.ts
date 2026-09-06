import { randomUUID } from 'crypto'
import { app, safeStorage } from 'electron'
import { dirname, join } from 'path'
import fs from 'fs'
import type { ModelConfig, ModelPreset, ModelProvider, ReasoningEffort } from '@shared/types'
import { supportsImageInput } from '@shared/modelCapabilities'

export const PROVIDER_PRESETS: Record<ModelProvider, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  custom: { baseUrl: '', model: '' }
}

export const MIN_CONTEXT_MESSAGES = 1
export const MAX_CONTEXT_MESSAGES = 50
export const DEFAULT_CONTEXT_MESSAGES = 50
export const DEFAULT_CONTEXT_TOKENS = 128_000

/** Internal context policy. The renderer does not ask users to tune provider limits. */
export function automaticContextTokens(provider: ModelProvider, model: string): number {
  const normalized = model.trim().toLocaleLowerCase('en-US')
  // DeepSeek V4 has a 1M context window and up to 384K output. Keep a
  // conservative input allowance for output plus tokenizer estimation error.
  if (provider === 'deepseek' && /(?:^|[-_])v4(?:[-_]|$)/.test(normalized)) return 600_000
  const namedWindow = normalized.match(/(?:^|[-_])(\d{1,4})k(?:[-_]|$)/)
  if (namedWindow) return Math.min(1_000_000, Math.max(8_000, Number(namedWindow[1]) * 1_000))
  return DEFAULT_CONTEXT_TOKENS
}

export function normalizeContextMessages(value: unknown): number {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_CONTEXT_MESSAGES
  return Math.min(MAX_CONTEXT_MESSAGES, Math.max(MIN_CONTEXT_MESSAGES, parsed))
}

function envProvider(): ModelProvider {
  const p = (process.env.MODEL_PROVIDER ?? 'deepseek') as ModelProvider
  return p === 'kimi' || p === 'deepseek' || p === 'custom' ? p : 'deepseek'
}

function makeDefaultPreset(): ModelPreset {
  const provider = envProvider()
  const preset = PROVIDER_PRESETS[provider]
  const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.MOONSHOT_API_KEY ?? process.env.MODEL_API_KEY ?? ''
  return {
    id: randomUUID(),
    name: provider === 'kimi' ? 'Kimi' : provider === 'deepseek' ? 'DeepSeek' : '自定义',
    provider,
    baseUrl: process.env.MODEL_BASE_URL ?? preset.baseUrl,
    apiKey,
    hasApiKey: Boolean(apiKey),
    model: process.env.MODEL ?? preset.model,
    capabilities: { imageInput: supportsImageInput(process.env.MODEL ?? preset.model) },
    contextMessages: DEFAULT_CONTEXT_MESSAGES,
    contextTokens: automaticContextTokens(provider, process.env.MODEL ?? preset.model)
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

function secretsFile(): string {
  return join(app.getPath('userData'), 'ai-agent-secrets.json')
}

export function normalizePreset(p: Partial<ModelPreset>): ModelPreset {
  const provider = (p.provider as ModelProvider) ?? 'deepseek'
  return {
    id: p.id ?? randomUUID(),
    name: p.name || (provider === 'kimi' ? 'Kimi' : provider === 'deepseek' ? 'DeepSeek' : '自定义'),
    provider,
    baseUrl: p.baseUrl ?? '',
    apiKey: p.apiKey ?? '',
    hasApiKey: p.hasApiKey ?? Boolean(p.apiKey),
    model: p.model ?? '',
    capabilities: p.capabilities ?? { imageInput: supportsImageInput(p.model ?? '') },
    // Kept in the serialized shape for backward compatibility. Runtime history
    // is token-budgeted and no longer truncated by a user-configurable count.
    contextMessages: DEFAULT_CONTEXT_MESSAGES,
    contextTokens: automaticContextTokens(provider, p.model ?? '')
  }
}

export function migrate(saved: Record<string, unknown>): ModelConfig {
  if (Array.isArray(saved.presets) && saved.presets.length > 0) {
    const presets = (saved.presets as Partial<ModelPreset>[]).map(normalizePreset)
    return {
      presets,
      activePresetId: (saved.activePresetId as string) ?? presets[0].id,
      reasoningEffort: (saved.reasoningEffort as ReasoningEffort) ?? 'medium'
    }
  }
  const provider = (saved.provider as ModelProvider) ?? envProvider()
  if (saved.baseUrl || saved.apiKey || saved.model) {
    const preset = normalizePreset({
      provider,
      baseUrl: (saved.baseUrl as string) ?? '',
      apiKey: (saved.apiKey as string) ?? '',
      model: (saved.model as string) ?? '',
      contextMessages: normalizeContextMessages(saved.contextMessages ?? DEFAULT_CONTEXT_MESSAGES)
    })
    return { presets: [preset], activePresetId: preset.id, reasoningEffort: 'medium' }
  }
  return defaults()
}

function encryptionAvailable(): boolean {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable())
  } catch {
    return false
  }
}

function readSecrets(): Record<string, string> {
  if (!encryptionAvailable() || !fs.existsSync(secretsFile())) return {}
  try {
    const encrypted = JSON.parse(fs.readFileSync(secretsFile(), 'utf-8')) as Record<string, string>
    return Object.fromEntries(
      Object.entries(encrypted).flatMap(([id, value]) => {
        try {
          return [[id, safeStorage.decryptString(Buffer.from(value, 'base64'))]]
        } catch {
          console.warn(`[model] failed to decrypt API key for preset ${id}`)
          return []
        }
      })
    )
  } catch (e) {
    console.warn('[model] failed to load encrypted secrets:', e)
    return {}
  }
}

function atomicWrite(file: string, value: string): void {
  fs.mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temp, value, { encoding: 'utf-8', mode: 0o600 })
    fs.renameSync(temp, file)
  } catch (e) {
    fs.rmSync(temp, { force: true })
    throw e
  }
}

function persist(): void {
  try {
    atomicWrite(configFile(), JSON.stringify(toPublicModelConfig(config), null, 2))
    if (encryptionAvailable()) {
      const encrypted = Object.fromEntries(
        config.presets
          .filter((preset) => preset.apiKey)
          .map((preset) => [preset.id, safeStorage.encryptString(preset.apiKey).toString('base64')])
      )
      atomicWrite(secretsFile(), JSON.stringify(encrypted, null, 2))
    } else if (config.presets.some((preset) => preset.apiKey)) {
      console.warn('[model] OS encryption unavailable; API keys are kept in memory only')
    }
  } catch (e) {
    console.warn('[model] failed to save config:', e)
  }
}

export function initModelConfig(): ModelConfig {
  config = defaults()
  try {
    if (fs.existsSync(configFile())) {
      config = migrate(JSON.parse(fs.readFileSync(configFile(), 'utf-8')) as Record<string, unknown>)
    }
    const secrets = readSecrets()
    config.presets = config.presets.map((preset) => {
      const apiKey = preset.apiKey || secrets[preset.id] || ''
      return { ...preset, apiKey, hasApiKey: Boolean(apiKey) }
    })
    persist()
  } catch (e) {
    console.warn('[model] failed to load config:', e)
  }
  return config
}

export function getModelConfig(): ModelConfig {
  return config
}

export function toPublicModelConfig(value: ModelConfig = config): ModelConfig {
  return {
    ...value,
    presets: value.presets.map((preset) => ({ ...preset, apiKey: '', hasApiKey: Boolean(preset.apiKey) }))
  }
}

export function getActivePreset(): ModelPreset | null {
  return config.presets.find((p) => p.id === config.activePresetId) ?? config.presets[0] ?? null
}

export function setModelConfig(cfg: Partial<ModelConfig>): ModelConfig {
  const existing = new Map(config.presets.map((preset) => [preset.id, preset]))
  const next = { ...config, ...cfg }
  config = {
    ...next,
    presets: (next.presets ?? []).map((incoming) => {
      const previous = existing.get(incoming.id)
      const apiKey = incoming.apiKey?.trim()
        ? incoming.apiKey.trim()
        : incoming.hasApiKey === false
          ? ''
          : previous?.apiKey ?? ''
      return normalizePreset({ ...incoming, apiKey, hasApiKey: Boolean(apiKey) })
    })
  }
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
