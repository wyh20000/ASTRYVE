import { useEffect, useMemo, useState } from 'react'
import { Conversations } from '@ant-design/x'
import type { ConversationItemType } from '@ant-design/x'
import { useSessionStore } from '../../stores/sessionStore'
import { useUiStore } from '../../stores/uiStore'
import { useChatStore } from '../../stores/chatStore'
import { itemTime, fullTime } from '../../lib/time'
import { Button, IconButton } from '../ui'
import { Icon } from '../ui/icons'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { normalizedProjectPath, sameProjectPath } from '../../lib/sessionNavigation'

const CHAT_GROUP = '普通对话'

/**
 * 会话列表（阶段 C · 设计文档 7.4）。
 *
 * 迁移方式：列表容器改用 Ant Design X 的 `Conversations`，
 * `items` / `activeKey` / `onActiveChange` / 分组全部走组件契约：
 *
 * - `items` 由 `sessionStore.sessions` 映射，项目按最近活动排序，
 *   无项目会话固定在最后一组；
 * - `activeKey` 绑定 `sessionStore.activeId`，`onActiveChange` 调用现有 `select`；
 * - 搜索仍由 `uiStore.searchQuery` 驱动，没有把搜索状态搬进组件内部；
 * - 删除仍是「先点删除、再确认」的两步流程，仍调用现有 `remove`。
 *
 * 行内容走 `label` 自定义渲染（文档 11 第 13 节明确允许：
 * 「Conversations 无法完整表达现有分组/确认时，使用自定义 label/menu 渲染」）。
 * 这么做的原因是**可访问性不能回退**：
 * - `Conversations` 的行是 `<li onClick>`，本身不可聚焦；
 *   因此行内保留真正的 `<button>`，Tab 可聚焦、Enter/Space 可激活
 *   （点击事件冒泡到 `<li>`，由 `onActiveChange` 统一处理，不重复调用 select）；
 * - 删除入口是行按钮的**平级**元素（嵌套 `<button>` 属非法 HTML 且无法分别聚焦）；
 * - 点击删除/确认不会连带切换会话（对冒泡做 stopPropagation）。
 */
export default function SessionList(): JSX.Element {
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const select = useSessionStore((s) => s.select)
  const remove = useSessionStore((s) => s.remove)
  const createWork = useSessionStore((s) => s.createWork)
  const recent = useWorkspaceStore((s) => s.recent)
  const revokeWorkspace = useWorkspaceStore((s) => s.revoke)
  const searchQuery = useUiStore((s) => s.searchQuery)
  const approvalRequests = useChatStore((s) => s.approvalRequests)

  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmWorkspaceId, setConfirmWorkspaceId] = useState<string | null>(null)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())

  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions
    const projects = new Map<string, { label: string; items: typeof filtered }>()
    const chats: typeof filtered = []
    for (const session of filtered) {
      if (!session.projectPath) { chats.push(session); continue }
      const projectPath = session.projectPath
      const workspace = recent.find((candidate) =>
        (!session.workspaceId || candidate.id === session.workspaceId) &&
        sameProjectPath(candidate.displayPath, projectPath))
      const key = workspace ? `workspace:${workspace.id}` : `path:${normalizedProjectPath(projectPath)}`
      const group = projects.get(key) ?? { label: workspace?.displayPath ?? projectPath, items: [] }
      group.items.push(session)
      projects.set(key, group)
    }
    const groups = [...projects].map(([key, group]) => ({ key, ...group }))
      .sort((left, right) => right.items[0].updatedAt - left.items[0].updatedAt)
    if (chats.length) groups.push({ key: CHAT_GROUP, label: CHAT_GROUP, items: chats })
    return groups
  }, [sessions, searchQuery, recent])

  useEffect(() => {
    const activeGroup = grouped.find((group) => group.items.some((session) => session.id === activeId))
    if (!activeGroup || activeGroup.label === CHAT_GROUP) return
    setCollapsedProjects((current) => {
      if (!current.has(activeGroup.label)) return current
      const next = new Set(current)
      next.delete(activeGroup.label)
      return next
    })
  }, [activeId, grouped])

  /*
   * 保持分组顺序：按项目最近活动展开，组名使用与界面一致的 label，
   * 由 `groupable.label` 渲染成项目自己的分组标题样式。
   */
  const items: ConversationItemType[] = grouped.flatMap((g) =>
    g.items.map((s) => {
      const active = s.id === activeId
      const confirming = s.id === confirmId
      const title = s.title || '新对话'
      return {
        key: s.id,
        group: g.label,
        // `group` 类供行内 hover 显示操作按钮使用（li 是 hover 的宿主元素）
        className: [
          'group',
          active ? '!bg-bg-active' : 'hover:!bg-bg-raised'
        ].join(' '),
        // 选中态 = 浅背景 + 左侧细强调标记（文档 8.2），不使用高饱和整块填充
        style: active ? { boxShadow: 'inset 2px 0 0 var(--accent)' } : undefined,
        label: (
          <span className="flex w-full min-w-0 items-center gap-1">
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              title={`${title} · ${fullTime(s.updatedAt)}`}
              /*
               * 不在这里调 select：点击会冒泡到 Conversations 的 <li>，
               * 由 onActiveChange 统一触发，避免同一次点击调用两次 store。
               */
              className={[
                'flex h-[42px] min-w-0 flex-1 items-center gap-2 text-left text-[14px] transition-colors',
                active ? 'text-txt-primary' : 'text-txt-secondary hover:text-txt-primary'
              ].join(' ')}
            >
              <span className="min-w-0 flex-1 truncate">{title}</span>
              {(approvalRequests[s.id]?.expiresAt ?? 0) > Date.now() &&
                <span className="shrink-0 rounded bg-accent-dim/25 px-1.5 py-0.5 text-[14px] text-accent">待审批</span>}
            </button>

            {/* 时间与操作固定在行右侧，不参与会话按钮的点击区域 */}
            <span className="flex shrink-0 items-center gap-1">
              {confirming ? (
                <Button
                  variant="danger"
                  size="sm"
                  aria-label={`确认删除 ${title}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void remove(s.id)
                    setConfirmId(null)
                  }}
                >
                  删除
                </Button>
              ) : (
                <>
                  <span className="text-[14px] text-txt-muted">{itemTime(s.updatedAt)}</span>
                  <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <IconButton
                      size="sm"
                      danger
                      icon={<Icon.Trash size={14} />}
                      label="删除会话"
                      hideTooltip
                      onClick={(event) => {
                        event.stopPropagation()
                        setConfirmId(s.id)
                      }}
                    />
                  </span>
                </>
              )}
            </span>
          </span>
        )
      }
    })
  )
  const projectGroups = grouped.filter((group) => group.label !== CHAT_GROUP).map((group) => group.label)
  const expandedKeys = projectGroups.filter((group) => !collapsedProjects.has(group))

  if (items.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="px-3 py-6 text-center text-[14px] text-txt-muted">暂无会话</div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1" onBlur={() => { setConfirmId(null); setConfirmWorkspaceId(null) }}>
      <Conversations
        className="h-full"
        items={items}
        activeKey={activeId ?? undefined}
        onActiveChange={(key) => select(String(key))}
        groupable={{
          collapsible: (group) => group !== CHAT_GROUP && !searchQuery.trim(),
          expandedKeys,
          onExpand: (keys) => setCollapsedProjects(new Set(projectGroups.filter((group) => !keys.includes(group)))),
          label: (group) => (
            <span className="flex min-w-0 items-center justify-between gap-1" title={group}>
              {group === CHAT_GROUP
                ? <span className="block max-w-[190px] truncate text-[14px] font-medium text-txt-muted">{group}</span>
                : <button type="button" aria-label={`折叠或展开 ${group}`} aria-expanded={expandedKeys.includes(group)}
                  className="block max-w-[190px] truncate text-left text-[14px] font-medium text-txt-muted">
                  {group.split(/[\\/]/).filter(Boolean).at(-1) ?? group}
                </button>}
              {group !== CHAT_GROUP && (() => {
                const workspace = recent.find((item) => sameProjectPath(item.displayPath, group))
                return workspace ? <span className="flex shrink-0 items-center gap-1">
                  <button type="button" aria-label={`在 ${workspace.name} 下新建工作会话`}
                    className="rounded p-1 text-txt-muted hover:text-accent"
                    onClick={(event) => { event.stopPropagation(); void createWork(workspace.id) }}>
                    <Icon.Plus size={13} />
                  </button>
                  {confirmWorkspaceId === workspace.id
                    ? <button type="button" aria-label={`确认移除 ${workspace.name} 的项目授权`}
                      className="rounded px-1 text-[14px] text-red-400 hover:bg-bg-raised"
                      onClick={(event) => {
                        event.stopPropagation()
                        setConfirmWorkspaceId(null)
                        void revokeWorkspace(workspace.id)
                      }}>确认移除</button>
                    : <button type="button" aria-label={`移除 ${workspace.name} 的项目授权`}
                      className="rounded p-1 text-txt-muted hover:text-red-400"
                      onClick={(event) => { event.stopPropagation(); setConfirmWorkspaceId(workspace.id) }}>
                      <Icon.Trash size={13} />
                    </button>}
                </span> : null
              })()}
            </span>
          )
        }}
        // 会话行目标高度 40~44px（文档 8.2）；行内自带左右留白
        styles={{ item: { height: 42, minHeight: 42, padding: '0 8px' } }}
      />
    </div>
  )
}
