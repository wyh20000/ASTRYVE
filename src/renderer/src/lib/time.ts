export type GroupKey = 'today' | 'yesterday' | 'earlier'

export function groupKey(ts: number): GroupKey {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  if (ts >= todayStart) return 'today'
  if (ts >= yesterdayStart) return 'yesterday'
  return 'earlier'
}

export function groupLabel(key: GroupKey): string {
  switch (key) {
    case 'today':
      return '今天'
    case 'yesterday':
      return '昨天'
    default:
      return '更早'
  }
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 列表项右侧时间：今天/昨天 → HH:MM；更早 → 周几 */
export function itemTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const key = groupKey(ts)
  if (key === 'earlier') return WEEKDAYS[d.getDay()]
  return `${hh}:${mm}`
}

export function fullTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
