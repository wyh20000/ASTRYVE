import { describe, expect, it } from 'vitest'
import { isExplicitChromeRequestForUnsupportedModel } from './browserConversation'

describe('unsupported-model Chrome hint', () => {
  it('only warns for a clear live Chrome request and never routes tools', () => {
    expect(isExplicitChromeRequestForUnsupportedModel('请查看浏览器当前页面')).toBe(true)
    expect(isExplicitChromeRequestForUnsupportedModel('帮我打开 Chrome 标签页')).toBe(true)
    expect(isExplicitChromeRequestForUnsupportedModel('检查这张图片')).toBe(false)
    expect(isExplicitChromeRequestForUnsupportedModel('讨论页面设计')).toBe(false)
  })
})
