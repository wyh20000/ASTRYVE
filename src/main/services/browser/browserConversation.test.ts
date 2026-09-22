import { describe, expect, it } from 'vitest'
import { prefersBrowserTools } from './browserConversation'

describe('prefersBrowserTools', () => {
  it.each([
    '用浏览器打开 https://example.com 并截图',
    '查看当前 Chrome 页面',
    '打开 example.com',
    '在这个网页点击提交按钮',
    '检查网站的控制台错误'
  ])('routes explicit live-browser request: %s', (request) => {
    expect(prefersBrowserTools(request)).toBe(true)
  })

  it.each([
    '解释一下浏览器的工作原理',
    '写一个网页组件',
    '搜索最新的 Chrome 新闻',
    '你好'
  ])('keeps ordinary chat out of browser tools: %s', (request) => {
    expect(prefersBrowserTools(request)).toBe(false)
  })
})
