import { describe, expect, it } from 'vitest'
import type { PluginMetadata } from '../../../shared/types'
import { resolvePluginSelection } from './pluginConversation'

const plugins: PluginMetadata[] = [
  { id: 'acme.browser', name: 'Acme Browser', version: '1.0.0', description: '', author: 'Acme',
    source: 'installed', sourceFormat: 'native', enabled: true, status: 'ready', permissions: [], capabilities: [], components: ['tools'], errors: [] },
  { id: 'disabled.tool', name: 'Disabled Tool', description: '', source: 'installed', sourceFormat: 'native',
    enabled: false, status: 'ready', permissions: [], capabilities: [], components: ['tools'], errors: [] }
]

describe('plugin conversation selection', () => {
  it('resolves an explicit mention and removes only that token', () => {
    expect(resolvePluginSelection('请用 @acme.browser 检查 @example 文本', [], plugins)).toEqual({
      pluginIds: ['acme.browser'], cleanedRequest: '请用 检查 @example 文本', trigger: '@acme.browser'
    })
  })

  it('gives explicit ids precedence and reports disabled/missing selections', () => {
    expect(resolvePluginSelection('@missing hello', ['acme.browser'], plugins).pluginIds).toEqual(['acme.browser'])
    expect(() => resolvePluginSelection('@disabled.tool hello', [], plugins)).toThrow('未启用')
    expect(() => resolvePluginSelection('@missing hello', [], plugins)).toThrow('未安装')
  })
})
