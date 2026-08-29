import { describe, it, expect } from 'vitest'
import { groupKey, groupLabel, itemTime } from './time'

describe('groupKey', () => {
  const now = Date.now()

  it('今天', () => {
    expect(groupKey(now)).toBe('today')
  })

  it('昨天', () => {
    expect(groupKey(now - 86400000)).toBe('yesterday')
  })

  it('更早', () => {
    expect(groupKey(now - 2 * 86400000)).toBe('earlier')
  })
})

describe('groupLabel', () => {
  it('分组标题映射正确', () => {
    expect(groupLabel('today')).toBe('今天')
    expect(groupLabel('yesterday')).toBe('昨天')
    expect(groupLabel('earlier')).toBe('更早')
  })
})

describe('itemTime', () => {
  it('今天返回 HH:MM（补零）', () => {
    const d = new Date()
    const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 5).getTime()
    expect(itemTime(ts)).toBe('09:05')
  })

  it('更早返回周几', () => {
    const d = new Date()
    const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7, 9, 5).getTime()
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    expect(itemTime(ts)).toBe(weekdays[new Date(ts).getDay()])
  })
})
