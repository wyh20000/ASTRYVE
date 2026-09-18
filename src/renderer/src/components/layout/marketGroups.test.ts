/**
 * 市场分组的契约测试。
 *
 * 分组是本次「对齐 Codex」新增的呈现逻辑，它只用数据中已有的字段
 * （`recommended` / `categories`），不虚构运营分组。这里把这些约束固化：
 * 搜索时不分组、推荐优先、其余只进入产品定义的固定分类，未知分类归入 Other。
 */
import { describe, expect, it } from 'vitest'
import type { PluginMarketEntry } from '@shared/types'
import { buildMarketGroups } from './SettingsPage'

function entry(overrides: Partial<PluginMarketEntry>): PluginMarketEntry {
  return {
    id: 'x', name: 'X', version: '1.0.0', description: '', author: 'A',
    sourceId: 'official', sourceName: 'Codex official', sourceKind: 'official',
    verified: true, permissions: [], categories: [], platforms: [], architectures: [],
    ...overrides
  }
}

describe('buildMarketGroups - 只按现有字段分组', () => {
  it('搜索时不分，返回单一「搜索结果」分组', () => {
    const groups = buildMarketGroups(
      [entry({ id: 'a', name: 'A', recommended: true, categories: ['写作'] }), entry({ id: 'b', name: 'B' })],
      'a'
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('搜索结果')
    expect(groups[0].entries.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('无查询时只接受官方精选白名单，兼容清理旧缓存的全量推荐标记', () => {
    const groups = buildMarketGroups([
      entry({ id: 'cat', categories: ['Developer Tools'] }),
      entry({ id: 'stale', recommended: true, categories: ['Developer Tools'] }),
      entry({ id: 'computer-use', recommended: false, categories: ['Productivity'] })
    ], '')
    expect(groups[0].title).toBe('Featured')
    expect(groups[0].entries.map((item) => item.id)).toEqual(['computer-use'])
    expect(groups.find((group) => group.title === 'Developer Tools')?.entries.map((item) => item.id)).toEqual(['cat', 'stale'])
  })

  it('非推荐条目按固定产品分类归组', () => {
    const groups = buildMarketGroups([
      entry({ id: 'a', categories: ['Productivity'] }),
      entry({ id: 'b', categories: ['Productivity'] }),
      entry({ id: 'c', categories: ['Security'] })
    ], '')
    const titles = groups.map((group) => group.title)
    expect(titles).toContain('Productivity')
    expect(titles).toContain('Security')
    expect(groups.find((group) => group.title === 'Productivity')!.entries).toHaveLength(2)
  })

  it('没有分类的条目归入「其他」，不会丢条目', () => {
    const groups = buildMarketGroups([entry({ id: 'noCat', categories: [] })], '')
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('Other')
    expect(groups[0].entries.map((item) => item.id)).toEqual(['noCat'])
  })

  it('空输入返回空分组（不产生空标题）', () => {
    expect(buildMarketGroups([], '')).toEqual([])
    expect(buildMarketGroups([], 'anything')).toEqual([])
  })

  it('兼容错误拼写 Scientfic Research 并归一化', () => {
    const groups = buildMarketGroups([entry({ id: 'science', categories: ['Scientfic Research'] })], '')
    expect(groups[0].title).toBe('Scientific Research')
  })

  it('所有条目都会进入分类区，Featured 条目允许同时出现在所属分类', () => {
    const input = [
      entry({ id: 'computer-use', recommended: true }),
      entry({ id: 'c1', categories: ['写作'] }),
      entry({ id: 'c2', categories: [] }),
      entry({ id: 'c3', categories: ['浏览器'] })
    ]
    const grouped = buildMarketGroups(input, '').flatMap((group) => group.entries.map((item) => item.id))
    expect([...new Set(grouped)].sort()).toEqual(['c1', 'c2', 'c3', 'computer-use'])
    expect(grouped.filter((id) => id === 'computer-use')).toHaveLength(2)
  })
})
