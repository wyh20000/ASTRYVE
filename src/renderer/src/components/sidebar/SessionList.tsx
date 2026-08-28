import { useMemo, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUiStore } from '../../stores/uiStore'
import { groupKey, groupLabel, itemTime, type GroupKey } from '../../lib/time'
import { Icon } from '../ui/icons'

const GROUP_ORDER: GroupKey[] = ['today', 'yesterday', 'earlier']

export default function SessionList(): JSX.Element {
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const select = useSessionStore((s) => s.select)
  const remove = useSessionStore((s) => s.remove)
  const searchQuery = useUiStore((s) => s.searchQuery)

  const [confirmId, setConfirmId] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = q
      ? sessions.filter((s) => s.title.toLowerCase().includes(q))
      : sessions
    const map: Record<GroupKey, typeof filtered> = { today: [], yesterday: [], earlier: [] }
    for (const s of filtered) map[groupKey(s.updatedAt)].push(s)
    return GROUP_ORDER.map((k) => ({ key: k, label: groupLabel(k), items: map[k] })).filter(
      (g) => g.items.length > 0
    )
  }, [sessions, searchQuery])

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      {grouped.length === 0 && (
        <div className="px-3 py-6 text-center text-[12px] text-txt-muted">暂无会话</div>
      )}
      {grouped.map((g) => (
        <div key={g.key} className="mb-1">
          <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-txt-muted">
            {g.label}
          </div>
          {g.items.map((s) => {
            const active = s.id === activeId
            const confirming = s.id === confirmId
            return (
              <div
                key={s.id}
                onClick={() => select(s.id)}
                onBlur={() => setConfirmId(null)}
                className={`group flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors ${
                  active ? 'bg-bg-active text-txt-primary' : 'text-txt-secondary hover:bg-bg-raised'
                }`}
                style={active ? { boxShadow: 'inset 2px 0 0 var(--accent)' } : undefined}
              >
                <span className="min-w-0 flex-1 truncate">{s.title || '新对话'}</span>
                {confirming ? (
                  <button
                    className="flex shrink-0 items-center gap-1 text-[11px] text-err"
                    onClick={(e) => {
                      e.stopPropagation()
                      void remove(s.id)
                      setConfirmId(null)
                    }}
                  >
                    <Icon.Trash size={12} />
                    删除
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-txt-muted">{itemTime(s.updatedAt)}</span>
                )}
                <button
                  className="hidden shrink-0 text-txt-muted hover:text-err group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmId(s.id)
                  }}
                >
                  <Icon.Trash size={13} />
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
