/**
 * 市场分组的契约测试。
 *
 * 分组是本次「对齐 Codex」新增的呈现逻辑，它只用数据中已有的字段
 * （`recommended` / `categories`），不虚构运营分组。这里把这些约束固化：
 * 搜索时不分组、推荐优先、其余按分类、无分类归入「其他」。
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

  it('无查询时推荐条目单独成组，且排在前面', () => {
    const groups = buildMarketGroups([
      entry({ id: 'cat', categories: ['开发'] }),
      entry({ id: 'rec', recommended: true, categories: ['开发'] })
    ], '')
    expect(groups[0].title).toBe('推荐')
    expect(groups[0].entries.map((item) => item.id)).toEqual(['rec'])
    expect(groups[1].title).toBe('开发')
    expect(groups[1].entries.map((item) => item.id)).toEqual(['cat'])
  })

  it('非推荐条目按第一个分类归组', () => {
    const groups = buildMarketGroups([
      entry({ id: 'a', categories: ['写作'] }),
      entry({ id: 'b', categories: ['写作'] }),
      entry({ id: 'c', categories: ['浏览器'] })
    ], '')
    const titles = groups.map((group) => group.title)
    expect(titles).toContain('写作')
    expect(titles).toContain('浏览器')
    expect(groups.find((group) => group.title === '写作')!.entries).toHaveLength(2)
  })

  it('没有分类的条目归入「其他」，不会丢条目', () => {
    const groups = buildMarketGroups([entry({ id: 'noCat', categories: [] })], '')
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('其他')
    expect(groups[0].entries.map((item) => item.id)).toEqual(['noCat'])
  })

  it('空输入返回空分组（不产生空标题）', () => {
    expect(buildMarketGroups([], '')).toEqual([])
    expect(buildMarketGroups([], 'anything')).toEqual([])
  })

  it('所有条目都会被分到某一组，不丢失', () => {
    const input = [
      entry({ id: 'r1', recommended: true }),
      entry({ id: 'c1', categories: ['写作'] }),
      entry({ id: 'c2', categories: [] }),
      entry({ id: 'c3', categories: ['浏览器'] })
    ]
    const grouped = buildMarketGroups(input, '').flatMap((group) => group.entries.map((item) => item.id))
    expect(grouped.sort()).toEqual(['c1', 'c2', 'c3', 'r1'])
  })
})
