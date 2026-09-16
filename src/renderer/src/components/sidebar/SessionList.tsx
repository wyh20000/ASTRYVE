import { useMemo, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUiStore } from '../../stores/uiStore'
import { groupKey, groupLabel, itemTime, fullTime, type GroupKey } from '../../lib/time'
import { Button, IconButton } from '../ui'
import { Icon } from '../ui/icons'

const GROUP_ORDER: GroupKey[] = ['today', 'yesterday', 'earlier']

/**
 * 会话列表。
 *
 * 设计约束（文档 8.2）：
 * - 会话行目标高度 40~44px；选中态使用浅背景 + 细强调标记，不做高饱和整块填充；
 * - 时间与操作图标保持 14px，靠颜色弱化而不是把字号缩到 10~11px；
 * - 会话行必须是真正的可聚焦控件，支持键盘 Enter/Space 切换。
 *
 * 结构说明：会话行是 <button>，删除入口是其**同级**元素而不是子元素
 * —— 嵌套 button 属于非法 HTML，且无法用键盘分别聚焦。
 */
export default function SessionList(): JSX.Element {
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const select = useSessionStore((s) => s.select)
  const remove = useSessionStore((s) => s.remove)
  const searchQuery = useUiStore((s) => s.searchQuery)

  const [confirmId, setConfirmId] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions
    const map: Record<GroupKey, typeof filtered> = { today: [], yesterday: [], earlier: [] }
    for (const s of filtered) map[groupKey(s.updatedAt)].push(s)
    return GROUP_ORDER.map((k) => ({ key: k, label: groupLabel(k), items: map[k] })).filter(
      (g) => g.items.length > 0
    )
  }, [sessions, searchQuery])

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2" onBlur={() => setConfirmId(null)}>
      {grouped.length === 0 && (
        <div className="px-3 py-6 text-center text-[14px] text-txt-muted">暂无会话</div>
      )}
      {grouped.map((g) => (
        <div key={g.key} className="mb-1">
          <div className="px-3 py-1 text-[14px] font-medium text-txt-muted">{g.label}</div>
          {g.items.map((s) => {
            const active = s.id === activeId
            const confirming = s.id === confirmId
            const title = s.title || '新对话'
            return (
              <div key={s.id} className="group relative flex items-center">
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  title={`${title} · ${fullTime(s.updatedAt)}`}
                  onClick={() => select(s.id)}
                  className={[
                    'flex h-[42px] min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-3 text-left text-[14px] transition-colors',
                    confirming ? 'pr-24' : 'pr-14',
                    active
                      ? 'bg-bg-active text-txt-primary'
                      : 'text-txt-secondary hover:bg-bg-raised hover:text-txt-primary'
                  ].join(' ')}
                  /* 选中态用「浅背景 + 左侧细强调标记」表达，符合文档 8.2 */
                  style={active ? { boxShadow: 'inset 2px 0 0 var(--accent)' } : undefined}
                >
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                </button>

                {/* 时间与操作固定在行右侧，不参与按钮的点击区域 */}
                <div className="pointer-events-none absolute right-2 flex items-center gap-1">
                  {confirming ? (
                    <span className="pointer-events-auto">
                      <Button
                        variant="danger"
                        size="sm"
                        aria-label={`确认删除 ${title}`}
                        onClick={() => {
                          void remove(s.id)
                          setConfirmId(null)
                        }}
                      >
                        删除
                      </Button>
                    </span>
                  ) : (
                    <>
                      <span className="text-[14px] text-txt-muted">{itemTime(s.updatedAt)}</span>
                      <span className="pointer-events-auto opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <IconButton
                          size="sm"
                          danger
                          icon={<Icon.Trash size={14} />}
                          label="删除会话"
                          hideTooltip
                          onClick={() => setConfirmId(s.id)}
                        />
                      </span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
