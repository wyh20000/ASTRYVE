import { describe, expect, it } from 'vitest'
import {
  browserToolNamesForRequest,
  hasRecentBrowserContext,
  prefersBrowserContinuation,
  prefersBrowserTools
} from './browserConversation'

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

describe('browserToolNamesForRequest', () => {
  it('only exposes active viewport screenshot for a current-page capture request', () => {
    const names = browserToolNamesForRequest('查看当前页面，截一张图给我')
    expect(names.has('browser.screenshotCurrent')).toBe(true)
    expect(names.has('browser.screenshot')).toBe(false)
    expect(names.has('browser.screenshotElement')).toBe(false)
  })

  it.each([
    '查看我当前浏览器已经打开的推荐页面，截一张图给我',
    '重新截一张',
    '再截一次'
  ])('forces active-page capture for current/repeat wording: %s', (request) => {
    const names = browserToolNamesForRequest(request)
    expect(names.has('browser.screenshotCurrent')).toBe(true)
    expect(names.has('browser.screenshot')).toBe(false)
    expect(names.has('browser.screenshotElement')).toBe(false)
  })

  it.each([
    '截一下页面里的头像',
    '把这个帖子区域截图给我',
    'take a screenshot of the login button element'
  ])('exposes element screenshot only for an explicit local capture: %s', (request) => {
    expect(browserToolNamesForRequest(request).has('browser.screenshotElement')).toBe(true)
  })

  it('recognizes a short repeat request only when recent messages prove browser context', () => {
    expect(prefersBrowserContinuation('重新截一张')).toBe(true)
    expect(hasRecentBrowserContext([{
      id: 'assistant', sessionId: 'session', role: 'assistant', content: '', status: 'done', timestamp: 1,
      attachments: [{
        id: 'shot', kind: 'image', name: 'browser-screenshot.jpg', contentType: 'image/jpeg',
        dataRef: 'data:image/jpeg;base64,AA==', meta: { source: 'browser' }
      }]
    }])).toBe(true)
    expect(hasRecentBrowserContext([{
      id: 'assistant', sessionId: 'session', role: 'assistant', content: '普通回答', status: 'done', timestamp: 1
    }])).toBe(false)
  })
})
