import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ai-agent-test' } }))

import { migrate, normalizePreset, PROVIDER_PRESETS } from './modelConfig'

describe('normalizePreset', () => {
  it('Kimi 预设默认支持视觉并给出视觉模型名', () => {
    const p = normalizePreset({
      id: 'x',
      provider: 'kimi',
      name: 'Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'k',
      model: 'moonshot-v1-8k',
      contextMessages: 20
    })
    expect(p.supportsVision).toBe(true)
    expect(p.visionModel).toBe('moonshot-v1-8k-vision-preview')
  })

  it('DeepSeek 预设默认支持视觉并给出视觉模型名', () => {
    const p = normalizePreset({ id: 'x', provider: 'deepseek' })
    expect(p.supportsVision).toBe(true)
    expect(p.visionModel).toBe('deepseek-v4-flash-vision-exp')
  })

  it('显式传入的视觉字段被保留', () => {
    const p = normalizePreset({
      id: 'x',
      provider: 'deepseek',
      supportsVision: true,
      visionModel: 'qwen-vl-plus'
    })
    expect(p.supportsVision).toBe(true)
    expect(p.visionModel).toBe('qwen-vl-plus')
  })

  it('补齐缺省字段（id/name/contextMessages）', () => {
    const p = normalizePreset({ provider: 'kimi' })
    expect(p.id).toBeTruthy()
    expect(p.name).toBe('Kimi')
    expect(p.contextMessages).toBe(20)
  })
})

describe('migrate', () => {
  it('旧扁平结构 → 多预设，并补齐视觉字段', () => {
    const cfg = migrate({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'k',
      model: 'deepseek-chat'
    })
    expect(cfg.presets).toHaveLength(1)
    expect(cfg.presets[0].model).toBe('deepseek-chat')
    expect(cfg.presets[0].supportsVision).toBe(true)
    expect(cfg.activePresetId).toBe(cfg.presets[0].id)
  })

  it('多预设结构迁移时补齐视觉字段、保留 reasoningEffort', () => {
    const cfg = migrate({
      presets: [
        { id: 'p1', name: 'Kimi', provider: 'kimi', baseUrl: 'u', apiKey: 'k', model: 'm', contextMessages: 10 }
      ],
      activePresetId: 'p1',
      reasoningEffort: 'high'
    })
    expect(cfg.presets[0].supportsVision).toBe(true)
    expect(cfg.reasoningEffort).toBe('high')
  })

  it('空配置返回默认（至少一个预设）', () => {
    const cfg = migrate({})
    expect(cfg.presets.length).toBeGreaterThan(0)
  })
})

describe('PROVIDER_PRESETS', () => {
  it('Kimi 与 DeepSeek 都有视觉模型名', () => {
    expect(PROVIDER_PRESETS.kimi.supportsVision).toBe(true)
    expect(PROVIDER_PRESETS.kimi.visionModel).toBeTruthy()
    expect(PROVIDER_PRESETS.deepseek.supportsVision).toBe(true)
    expect(PROVIDER_PRESETS.deepseek.visionModel).toBe('deepseek-v4-flash-vision-exp')
  })
})
