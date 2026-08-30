import { describe, expect, it } from 'vitest'
import { extractSourceCitations } from './searchSources'

describe('extractSourceCitations', () => {
  it('提取 Markdown 链接、裸 URL 并按地址去重', () => {
    const sources = extractSourceCitations(
      '参考 [官方公告](https://example.com/news) 和 https://docs.example.com/guide。再次引用 [公告](https://example.com/news)。'
    )
    expect(sources).toEqual([
      { title: '官方公告', url: 'https://example.com/news' },
      { title: 'docs.example.com', url: 'https://docs.example.com/guide' }
    ])
  })

  it('忽略非 HTTP 链接并限制来源数量', () => {
    const input = Array.from({ length: 20 }, (_, i) => `[来源${i}](https://example.com/${i})`).join('\n')
    expect(extractSourceCitations(`[本地](file:///tmp/a)\n${input}`)).toHaveLength(12)
  })
})
