import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ai-agent-test' } }))

import { migrate, normalizeContextMessages, normalizePreset, PROVIDER_PRESETS } from './modelConfig'
import { supportsBuiltInSearch, supportsImageInput } from '@shared/modelCapabilities'

describe('normalizePreset', () => {
  it('Kimi 预设只使用当前模型，不附加备用视觉模型', () => {
    const p = normalizePreset({
      id: 'x',
      provider: 'kimi',
      name: 'Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: 'k',
      model: 'moonshot-v1-8k',
      contextMessages: 20
    })
    expect(p.model).toBe('moonshot-v1-8k')
    expect('supportsVision' in p).toBe(false)
    expect('visionModel' in p).toBe(false)
  })

  it('DeepSeek 默认模型保持文本模型', () => {
    const p = normalizePreset({ id: 'x', provider: 'deepseek' })
    expect(p.model).toBe('')
    expect('supportsVision' in p).toBe(false)
    expect('visionModel' in p).toBe(false)
  })

  it('旧配置中的视觉路由字段会被移除', () => {
    const legacy = {
      id: 'x',
      provider: 'deepseek' as const,
      supportsVision: true,
      visionModel: 'qwen-vl-plus'
    }
    const p = normalizePreset(legacy)
    expect('supportsVision' in p).toBe(false)
    expect('visionModel' in p).toBe(false)
  })

  it('补齐缺省字段（id/name/contextMessages）', () => {
    const p = normalizePreset({ provider: 'kimi' })
    expect(p.id).toBeTruthy()
    expect(p.name).toBe('Kimi')
    expect(p.contextMessages).toBe(20)
  })

  it('上下文消息数强制限制在 1–50', () => {
    expect(normalizePreset({ provider: 'deepseek', contextMessages: 20_000_000 }).contextMessages).toBe(50)
    expect(normalizePreset({ provider: 'deepseek', contextMessages: -3 }).contextMessages).toBe(1)
  })
})

describe('normalizeContextMessages', () => {
  it.each([
    [undefined, 20],
    ['abc', 20],
    [0, 1],
    [12.9, 12],
    [50, 50],
    [51, 50],
    [20_000_000, 50]
  ])('将 %s 规范化为 %s', (input, expected) => {
    expect(normalizeContextMessages(input)).toBe(expected)
  })
})

describe('migrate', () => {
  it('旧扁平结构 → 多预设，不再补齐视觉路由字段', () => {
    const cfg = migrate({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'k',
      model: 'deepseek-chat'
    })
    expect(cfg.presets).toHaveLength(1)
    expect(cfg.presets[0].model).toBe('deepseek-chat')
    expect('supportsVision' in cfg.presets[0]).toBe(false)
    expect('visionModel' in cfg.presets[0]).toBe(false)
    expect(cfg.activePresetId).toBe(cfg.presets[0].id)
  })

  it('多预设结构迁移时移除旧视觉字段、保留 reasoningEffort', () => {
    const cfg = migrate({
      presets: [
        {
          id: 'p1',
          name: 'Kimi',
          provider: 'kimi',
          baseUrl: 'u',
          apiKey: 'k',
          model: 'moonshot-v1-8k',
          contextMessages: 10,
          supportsVision: true,
          visionModel: 'moonshot-v1-8k-vision-preview'
        }
      ],
      activePresetId: 'p1',
      reasoningEffort: 'high'
    })
    expect('supportsVision' in cfg.presets[0]).toBe(false)
    expect('visionModel' in cfg.presets[0]).toBe(false)
    expect(cfg.reasoningEffort).toBe('high')
  })

  it('空配置返回默认（至少一个预设）', () => {
    const cfg = migrate({})
    expect(cfg.presets.length).toBeGreaterThan(0)
  })
})

describe('PROVIDER_PRESETS', () => {
  it('Kimi 与 DeepSeek 默认值均不包含备用视觉模型', () => {
    expect(PROVIDER_PRESETS.kimi.model).toBe('moonshot-v1-8k')
    expect(PROVIDER_PRESETS.deepseek.model).toBe('deepseek-v4-pro')
    expect('visionModel' in PROVIDER_PRESETS.kimi).toBe(false)
    expect('visionModel' in PROVIDER_PRESETS.deepseek).toBe(false)
  })
})

describe('supportsImageInput', () => {
  it.each(['deepseek-v4-pro', 'deepseek-chat', 'moonshot-v1-8k'])('%s 被识别为文本模型', (model) => {
    expect(supportsImageInput(model)).toBe(false)
  })

  it.each([
    'deepseek-v4-flash-vision-exp',
    'moonshot-v1-8k-vision-preview',
    'qwen2.5-vl-72b',
    'glm-4v-plus',
    'gpt-4o',
    'kimi-k3'
  ])('%s 被识别为多模态模型', (model) => {
    expect(supportsImageInput(model)).toBe(true)
  })
})

describe('supportsBuiltInSearch', () => {
  it('只为已适配内置搜索协议的提供方开放入口', () => {
    expect(supportsBuiltInSearch('deepseek')).toBe(true)
    expect(supportsBuiltInSearch('kimi')).toBe(true)
    expect(supportsBuiltInSearch('custom')).toBe(false)
    expect(supportsBuiltInSearch(undefined)).toBe(false)
  })
})
