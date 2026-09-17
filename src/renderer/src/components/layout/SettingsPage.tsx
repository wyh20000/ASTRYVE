import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { useThemeStore } from '../../stores/themeStore'
import { useModelStore } from '../../stores/modelStore'
import { normalizeHexColor, type ThemeMode } from '@shared/themePreferences'
import { resolveTheme } from '../../theme/tokens'
import {
  Button,
  Checkbox,
  FormSection,
  IconButton,
  SearchInput,
  SegmentedControl,
  SelectControl,
  SettingRow,
  TagChip,
  TextArea,
  TextInput,
  ThemeModeCards,
  ToggleSwitch
} from '../ui'
import type { ModelProvider, ModelConfig, ModelPreset, PluginMarketEntry, PluginMcpConnectInput, PluginMcpServerView, PluginMetadata, PluginPermission, SkillCatalogItem, SkillMetadata, SkillSource } from '@shared/types'
import { Icon } from '../ui/icons'
import { useSkillStore } from '../../stores/skillStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { AgentSettingsSection } from '../chat/AgentControls'
import { usePluginStore } from '../../stores/pluginStore'
import { compareSemver } from '@shared/semver'
import type { AuditEvent } from '@shared/agent'
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer'

type Section = 'theme' | 'model' | 'agent' | 'extensions' | 'security'
type ExtensionTab = 'plugins' | 'skills'

const PROVIDER_PRESETS: Record<ModelProvider, { baseUrl: string; model: string }> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro'
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k'
  },
  custom: { baseUrl: '', model: '' }
}

/** 设置页（独立页面）：左侧导航列 + 右侧内容面板 */
export default function SettingsPage(): JSX.Element {
  const closeSettings = useUiStore((s) => s.closeSettings)
  const [section, setSection] = useState<Section>('theme')
  const [settingsQuery, setSettingsQuery] = useState('')
  const normalizedQuery = settingsQuery.trim().toLowerCase()
  const allNavItems: Array<{ id: Section; label: string; icon: JSX.Element }> = [
    { id: 'theme', label: '主题设置', icon: <Icon.Settings size={14} /> },
    { id: 'model', label: '模型设置', icon: <Icon.Brain size={14} /> },
    { id: 'agent', label: 'Agent 设置', icon: <Icon.Shield size={14} /> },
    { id: 'extensions', label: '插件', icon: <Icon.FileDir size={14} /> },
    { id: 'security', label: '安全与数据', icon: <Icon.Shield size={14} /> }
  ]
  const navItems = allNavItems.filter(
    (item) => !normalizedQuery || item.label.toLowerCase().includes(normalizedQuery)
  )

  return (
    <div className="flex min-h-0 flex-1 bg-bg-app text-txt-primary">
      <div className="flex w-[164px] shrink-0 flex-col border-r border-border bg-bg-panel sm:w-[200px]">
        <div className="flex h-12 items-center gap-2 px-3">
          <IconButton icon={<Icon.X size={15} />} label="返回" onClick={closeSettings} />
          <span className="text-[14px] font-semibold text-txt-primary">设置</span>
        </div>
        <div className="px-3 pb-2">
          <SearchInput
            aria-label="搜索设置项"
            value={settingsQuery}
            onChange={setSettingsQuery}
            placeholder="搜索设置项..."
          />
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {navItems.map((item) => (
            <NavItem key={item.id} active={section === item.id} icon={item.icon} label={item.label}
              onClick={() => setSection(item.id)} />
          ))}
          {navItems.length === 0 && (
            <div className="px-2 py-3 text-[14px] leading-[22px] text-txt-muted">没有匹配的设置项</div>
          )}
        </nav>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[820px] px-4 py-5 sm:px-6 sm:py-6">
          {section === 'theme' ? <ThemeSection /> : section === 'model' ? <ModelSection /> : section === 'agent' ? <AgentSettingsSection /> : section === 'extensions' ? <ExtensionsSection /> : <SecuritySection />}
        </div>
      </div>
    </div>
  )
}

export function ExtensionsSection({ initialTab = 'plugins' }: { initialTab?: ExtensionTab }): JSX.Element {
  const [tab, setTab] = useState<ExtensionTab>(initialTab)
  return <div className="pb-12">
    <div role="tablist" aria-label="插件与技能" className="mb-7 flex items-center gap-1">
      <ExtensionTabButton active={tab === 'plugins'} controls="extensions-plugin-panel" onClick={() => setTab('plugins')}>
        插件
      </ExtensionTabButton>
      <ExtensionTabButton active={tab === 'skills'} controls="extensions-skill-panel" onClick={() => setTab('skills')}>
        技能
      </ExtensionTabButton>
    </div>
    {tab === 'plugins'
      ? <div id="extensions-plugin-panel" role="tabpanel"><PluginSection /></div>
      : <div id="extensions-skill-panel" role="tabpanel"><SkillsSection /></div>}
  </div>
}

function ExtensionTabButton({ active, controls, onClick, children }: {
  active: boolean
  controls: string
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return <button
    type="button"
    role="tab"
    aria-selected={active}
    aria-controls={controls}
    tabIndex={active ? 0 : -1}
    className={`rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors ${active ? 'bg-bg-active text-txt-primary' : 'text-txt-muted hover:bg-bg-raised hover:text-txt-secondary'}`}
    onClick={onClick}
  >{children}</button>
}

export function PluginSection(): JSX.Element {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'installed' | 'market' | 'sources' | 'developer'>('installed')
  const items = usePluginStore((state) => state.items)
  const marketEntries = usePluginStore((state) => state.marketEntries ?? [])
  const loading = usePluginStore((state) => state.loading)
  const mutating = usePluginStore((state) => state.mutating)
  const error = usePluginStore((state) => state.error)
  const load = usePluginStore((state) => state.load)
  const loadMarketplace = usePluginStore((state) => state.loadMarketplace)
  const importLocal = usePluginStore((state) => state.importLocal)
  const setEnabled = usePluginStore((state) => state.setEnabled)
  const recover = usePluginStore((state) => state.recover)
  const preferences = usePluginStore((state) => state.preferences)
  const loadPreferences = usePluginStore((state) => state.loadPreferences)
  const setAutoUpdate = usePluginStore((state) => state.setAutoUpdate)
  const loadConnections = usePluginStore((state) => state.loadConnections)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const importMenuRef = useRef<HTMLDetailsElement>(null)
  const closeImportMenu = (): void => {
    if (importMenuRef.current) importMenuRef.current.open = false
    setImportMenuOpen(false)
  }
  useDismissibleLayer(importMenuRef, importMenuOpen, closeImportMenu)
  useEffect(() => { void load(); void loadPreferences(); void loadConnections(); if (loadMarketplace) void loadMarketplace() }, [load, loadConnections, loadMarketplace, loadPreferences])
  const filtered = filterPlugins(items, query)
  const marketById = new Map(latestMarketplaceEntries(marketEntries).map((entry) => [entry.id, entry]))
  return <div>
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-[220px] flex-1">
        <h1 className="selectable text-[20px] font-semibold text-txt-primary">插件</h1>
        <p className="mt-1 text-[14px] text-txt-muted">在你常用的工具中与 AI Agent 协作</p>
      </div>
      <details ref={importMenuRef} onToggle={(event) => setImportMenuOpen(event.currentTarget.open)} className="group relative shrink-0">
        <summary aria-haspopup="menu" aria-expanded={importMenuOpen} className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border bg-bg-raised px-3 py-1.5 text-[14px] font-medium text-txt-secondary transition-colors hover:border-border-strong hover:bg-bg-active hover:text-txt-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          {mutating ? '处理中…' : '添加'}
          <Icon.ChevronDown size={14} className="transition-transform group-open:rotate-180" />
        </summary>
        <div hidden={!importMenuOpen} role="menu" style={{ backgroundColor: 'var(--surface-overlay)' }} className="absolute right-0 top-full z-40 mt-2 w-[min(280px,calc(100vw-2rem))] rounded-xl border border-border-strong bg-surface-overlay p-1.5 shadow-overlay">
          <Button
            block
            variant="text"
            disabled={mutating}
            icon={<Icon.Folder size={14} />}
            className="min-h-11 justify-start rounded-lg"
            onClick={() => { closeImportMenu(); void importLocal('directory') }}
          >
            导入文件夹
          </Button>
          <Button
            block
            variant="text"
            disabled={mutating}
            icon={<Icon.File size={14} />}
            className="min-h-11 justify-start rounded-lg"
            onClick={() => { closeImportMenu(); void importLocal('zip') }}
          >
            导入 ZIP
          </Button>
        </div>
      </details>
    </div>
    <div role="tablist" aria-label="插件页面" className="mt-6 flex gap-6 border-b border-border">
      {([['installed', '已安装'], ['market', '插件市场'], ['sources', '市场源'], ['developer', '开发者']] as const).map(([id, label]) =>
        <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}
          className={`-mb-px border-b-2 pb-2.5 text-[14px] transition-colors ${view === id ? 'border-accent text-txt-primary' : 'border-transparent text-txt-muted hover:text-txt-secondary'}`}>{label}</button>)}
    </div>
    <div className="mt-6">
      <SearchInput
        aria-label="搜索插件"
        value={query}
        onChange={setQuery}
        placeholder="搜索插件"
      />
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-950/30 px-3 py-2 text-[14px] text-red-300">{error}</p>}
    {view === 'installed' && <section className="mt-7">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <h2 className="text-[14px] font-semibold text-txt-primary">已安装</h2>
        <span className="text-[14px] tabular-nums text-txt-muted">{items.length}</span>
        {/* title 挂在外层：Checkbox 内部会把 title 落到 input 上，光悬停文字不会提示 */}
        <span className="ml-auto" title="仅限同一来源和发布者、没有新增权限的更高版本；应用启动时检查">
          <Checkbox checked={preferences.autoUpdate} onChange={(next) => void setAutoUpdate(next)} className="text-[14px] text-txt-muted">
            自动安装安全更新
          </Checkbox>
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8">
        {filtered.map((plugin) => <PluginRow key={plugin.id} plugin={plugin} marketEntry={marketById.get(plugin.id)}
          onToggle={(next) => void setEnabled(plugin.id, next)}
          onRecover={() => void recover(plugin.id)} />)}
      </div>
      {!loading && !filtered.length && <div className="flex min-h-[220px] flex-col items-center justify-center px-4 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-raised text-txt-muted">
          <Icon.FileDir size={18} />
        </span>
        <h3 className="mt-4 text-[14px] font-medium text-txt-primary">{items.length ? '没有找到匹配的插件' : '尚未安装插件'}</h3>
        <p className="mt-1 max-w-[360px] text-[14px] leading-5 text-txt-muted">
          {items.length ? '请尝试其他关键词。' : '点击“添加”可安全导入文件夹或 ZIP；导入后默认禁用。'}
        </p>
      </div>}
    </section>}
    {view === 'market' && <PluginMarketView entries={marketEntries} installed={items} query={query} />}
    {view === 'sources' && <PluginSourcesView />}
    {view === 'developer' && <section className="mt-7 rounded-xl border border-border bg-bg-panel p-5">
      <h2 className="text-[14px] font-semibold">开发者</h2>
      <p className="mt-2 text-[14px] leading-5 text-txt-muted">使用 plugin.json 声明工具、权限和入口。开发包仍需经过相同的路径、大小、schema 与权限校验；本地导入不会自动启用。</p>
    </section>}
  </div>
}

type MarketScope = 'recommended' | 'official' | 'community' | 'all'
interface MarketFilter { scope: MarketScope; category: string; query: string }

export function filterMarketplaceEntries(entries: PluginMarketEntry[], filter: MarketFilter): PluginMarketEntry[] {
  const query = filter.query.trim().toLocaleLowerCase()
  return entries.filter((entry) => {
    const matchesScope = filter.scope === 'all' ||
      (filter.scope === 'recommended' && entry.sourceKind === 'official' && entry.recommended !== false) ||
      (filter.scope === 'official' && entry.sourceKind === 'official') ||
      (filter.scope === 'community' && entry.sourceKind !== 'official')
    const matchesCategory = filter.category === 'all' || entry.categories.includes(filter.category)
    const searchable = [entry.name, entry.description, entry.author, entry.sourceName,
      ...entry.categories, ...(entry.capabilities ?? []), ...(entry.components ?? []), ...(entry.dataTargets ?? [])]
      .join(' ').toLocaleLowerCase()
    return matchesScope && matchesCategory && (!query || searchable.includes(query))
  })
}

export function listMarketplaceCategories(entries: PluginMarketEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.categories))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

interface PluginInstallRisk {
  mode: 'install' | 'update' | 'installed' | 'older'
  addedPermissions: PluginPermission[]
  sourceChanged: boolean
  signingChanged: boolean
  publisherUnknown: boolean
  requiresFreshApproval: boolean
}

export function describePluginInstallRisk(
  entry: PluginMarketEntry,
  installed: PluginMetadata | undefined,
  _releases: PluginMarketEntry[]
): PluginInstallRisk {
  if (!installed) return { mode: 'install', addedPermissions: entry.permissions, sourceChanged: false, signingChanged: false, publisherUnknown: false, requiresFreshApproval: false }
  if (installed.version === entry.version) return { mode: 'installed', addedPermissions: [], sourceChanged: false, signingChanged: false, publisherUnknown: false, requiresFreshApproval: false }
  if (installed.version && compareSemver(entry.version, installed.version) < 0) return { mode: 'older', addedPermissions: [], sourceChanged: false, signingChanged: false, publisherUnknown: false, requiresFreshApproval: false }
  const previous = installed.installOrigin
  const addedPermissions = entry.permissions.filter((permission) => !installed.permissions.includes(permission))
  const sourceChanged = Boolean(previous && previous.sourceId !== entry.sourceId)
  const signingChanged = Boolean(previous && (previous.publisherId ?? '') !== (entry.publisherId ?? ''))
  const publisherUnknown = !previous
  return {
    mode: 'update', addedPermissions, sourceChanged, signingChanged, publisherUnknown,
    requiresFreshApproval: Boolean(addedPermissions.length || sourceChanged || signingChanged || publisherUnknown)
  }
}

function latestMarketplaceEntries(entries: PluginMarketEntry[]): PluginMarketEntry[] {
  const latest = new Map<string, PluginMarketEntry>()
  for (const entry of entries) {
    const key = `${entry.sourceId}:${entry.id}`
    const current = latest.get(key)
    if (!current || compareSemver(entry.version, current.version) > 0) latest.set(key, entry)
  }
  return [...latest.values()]
}

function PluginMarketView({ entries, installed, query }: { entries: PluginMarketEntry[]; installed: PluginMetadata[]; query: string }): JSX.Element {
  const install = usePluginStore((state) => state.installMarket)
  const mutating = usePluginStore((state) => state.mutating)
  const [scope, setScope] = useState<MarketScope>('recommended')
  const [pending, setPending] = useState<PluginMarketEntry>()
  const opener = useRef<HTMLElement | null>(null)
  // 分类筛选 UI 已移除，固定用 'all'；搜索仍覆盖 categories（见 filterMarketplaceEntries）
  const visible = latestMarketplaceEntries(filterMarketplaceEntries(entries, { scope, category: 'all', query }))
  const openDetails = (entry: PluginMarketEntry, element: HTMLElement): void => { opener.current = element; setPending(entry) }
  const closeDetails = (): void => { setPending(undefined); queueMicrotask(() => opener.current?.focus()) }
  /*
   * 分组（对齐 Codex 的「热门 / 新品推荐 / 分类」区块）。
   * 重要：只用数据里已有的字段（recommended / categories），不虚构运营分组。
   * 搜索时不做分组 —— 搜索结果应当是一个扁平列表，分组会干扰查找。
   */
  const groups = buildMarketGroups(visible, query)
  return <section className="mt-7">
    <div className="flex flex-wrap gap-2" role="group" aria-label="市场范围">
      {([['recommended', '推荐'], ['official', '官方'], ['community', '社区'], ['all', '全部']] as const).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={scope === id} onClick={() => setScope(id)} className={`rounded-full px-3 py-1.5 text-[14px] transition-colors ${scope === id ? 'bg-accent-dim text-accent' : 'bg-bg-raised text-txt-muted hover:text-txt-secondary'}`}>{label}</button>)}
    </div>
    {groups.map((group) => <div key={group.title} className="mt-6">
      <h3 className="text-[14px] font-medium text-txt-secondary">{group.title}</h3>
      <div className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {group.entries.map((entry) => <MarketCard key={`${entry.sourceId}:${entry.id}:${entry.version}`} entry={entry}
          installed={installed.find((item) => item.id === entry.id)} releases={entries} mutating={mutating} onOpen={openDetails} />)}
      </div>
    </div>)}
    {!visible.length && <EmptySkills label={entries.length ? '没有符合当前筛选条件的插件' : '正在同步 Codex 官方市场；也可以在“市场源”添加其他来源'} />}
    {pending && <PluginMarketDetails entry={pending} installed={installed.find((item) => item.id === pending.id)} releases={entries}
      mutating={mutating} onClose={closeDetails} onConfirm={() => void install(pending.sourceId, pending.id, pending.version).then((ok) => { if (ok) closeDetails() })} />}
  </section>
}

/**
 * 按现有字段把市场条目分成若干区块。
 *
 * 不使用任何虚构的运营数据：
 * - `recommended` 为 true 的进「推荐」区；
 * - 其余按 `categories[0]` 归类；无分类则进「其他」。
 * 搜索状态下不分组，直接返回单一列表。
 */
export function buildMarketGroups(
  entries: PluginMarketEntry[],
  query: string
): Array<{ title: string; entries: PluginMarketEntry[] }> {
  if (query.trim()) return entries.length ? [{ title: '搜索结果', entries }] : []
  const recommended = entries.filter((entry) => entry.recommended)
  const rest = entries.filter((entry) => !entry.recommended)
  const byCategory = new Map<string, PluginMarketEntry[]>()
  for (const entry of rest) {
    const category = entry.categories[0]?.trim() || '其他'
    const bucket = byCategory.get(category)
    if (bucket) bucket.push(entry)
    else byCategory.set(category, [entry])
  }
  const groups: Array<{ title: string; entries: PluginMarketEntry[] }> = []
  if (recommended.length) groups.push({ title: '推荐', entries: recommended })
  for (const [title, categoryEntries] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
    groups.push({ title, entries: categoryEntries })
  }
  return groups
}

/**
 * 市场卡片（Codex 风格）：图标 + 名称 + 右上角操作按钮。
 *
 * 刻意不在卡片上堆叠作者 / 权限条数 / 来源等文字：
 * 这些信息在详情抽屉里完整呈现，卡片保持轻量更接近 Codex。
 * 卡片本身可点开详情（保留 aria-label），操作按钮独立可聚焦。
 */
function MarketCard({ entry, installed, releases, mutating, onOpen }: {
  entry: PluginMarketEntry; installed?: PluginMetadata; releases: PluginMarketEntry[]; mutating: boolean
  onOpen: (entry: PluginMarketEntry, element: HTMLElement) => void
}): JSX.Element {
  return <article className="group flex items-center gap-3 border-b border-border py-3 transition-colors hover:bg-bg-active">
    <PluginLogo entry={entry} />
    <button type="button" className="min-w-0 flex-1 text-left" onClick={(event) => onOpen(entry, event.currentTarget)}
      aria-label={`查看 ${entry.name} 详情`}>
      <span className="flex flex-wrap items-baseline gap-1.5">
        <strong className="truncate text-[14px] text-txt-primary">{entry.name}</strong>
        <span className="text-[14px] tabular-nums text-txt-muted">{entry.version}</span>
        {entry.verified && <span className="text-[14px] text-accent">已验证</span>}
      </span>
      <span className="mt-0.5 block truncate text-[14px] text-txt-muted">{entry.description}</span>
      {entry.installable === false && <span className="mt-0.5 block truncate text-[14px] text-warn">{entry.unavailableReason}</span>}
    </button>
    <MarketActionButton entry={entry} installed={installed} releases={releases} mutating={mutating} onOpen={onOpen} />
  </article>
}
function MarketActionButton({ entry, installed, releases, mutating, onOpen }: {
  entry: PluginMarketEntry; installed?: PluginMetadata; releases: PluginMarketEntry[]; mutating: boolean
  onOpen: (entry: PluginMarketEntry, element: HTMLElement) => void
}): JSX.Element {
  const risk = describePluginInstallRisk(entry, installed, releases)
  const label = entry.installable === false ? '待支持' : risk.mode === 'installed' ? '已安装' : risk.mode === 'older' ? '版本较旧' : risk.mode === 'update' ? '更新' : '安装'
  if (risk.mode === 'install' || risk.mode === 'installed') {
    return <IconButton size="sm" label={label} hideTooltip={false} disabled={entry.installable === false || risk.mode === 'installed' || mutating}
      icon={risk.mode === 'installed' ? <Icon.Check size={14} /> : <Icon.Plus size={14} />}
      onClick={(event) => onOpen(entry, event.currentTarget)} />
  }
  return <Button size="sm" title={entry.unavailableReason} disabled={entry.installable === false || risk.mode === 'older' || mutating}
    onClick={(event) => onOpen(entry, event.currentTarget)}>{label}</Button>
}

interface DialogFocusEvent { key: string; shiftKey: boolean; target: unknown; preventDefault: () => void }
interface DialogFocusRoot { querySelectorAll: (selector: string) => ArrayLike<{ focus: () => void }> }

export function trapPluginDialogFocus(event: DialogFocusEvent, root: DialogFocusRoot): void {
  if (event.key !== 'Tab') return
  const focusable = Array.from(root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if ((!event.shiftKey && event.target === last) || (event.shiftKey && event.target === first)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  }
}

export function PluginMarketDetails({ entry, installed, releases, mutating, onClose, onConfirm }: {
  entry: PluginMarketEntry; installed?: PluginMetadata; releases: PluginMarketEntry[]; mutating: boolean
  onClose: () => void; onConfirm: () => void
}): JSX.Element {
  const risk = describePluginInstallRisk(entry, installed, releases)
  const dialog = useRef<HTMLElement | null>(null)
  const componentLabels: Record<string, string> = { skills: 'Skills', tools: '工具', mcp: 'MCP / 外部账号', hooks: 'Hooks' }
  const action = entry.installable === false ? '暂不可安装' : risk.mode === 'installed' ? '已安装' :
    risk.mode === 'install' ? '校验并安装' : risk.mode === 'older' ? '版本较旧' : risk.requiresFreshApproval ? '更新并重新确认' : '校验并更新'
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onMouseDown={onClose}>
    <aside ref={dialog} role="dialog" aria-modal="true" aria-labelledby="plugin-detail-title" tabIndex={-1}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); else if (dialog.current) trapPluginDialogFocus(event, dialog.current as unknown as DialogFocusRoot) }} onMouseDown={(event) => event.stopPropagation()}
      className="h-full w-full max-w-[560px] overflow-y-auto border-l border-border bg-bg-panel p-5 shadow-2xl sm:p-7">
      <div className="flex items-start gap-4"><PluginLogo entry={entry} size="lg" /><div className="min-w-0 flex-1"><h2 id="plugin-detail-title" className="text-[17px] font-semibold">{entry.name}</h2>
        <p className="mt-1 text-[14px] text-txt-muted">{entry.author} · {entry.sourceName} · {entry.version}</p></div>
        <IconButton autoFocus icon={<Icon.X size={16} />} label="关闭插件详情" onClick={onClose} /></div>
      <p className="mt-5 text-[14px] leading-6 text-txt-secondary">{entry.description}</p>
      <div className="mt-5 grid gap-3 rounded-xl bg-bg-raised p-4 text-[14px] sm:grid-cols-2">
        <DetailField label="来源">{sourceKindLabel(entry.sourceKind)}{entry.verified ? ' · 已验证' : ' · 未验证'}</DetailField>
        <DetailField label="兼容性">{compatibilityLabel(entry)}</DetailField>
        <DetailField label="组件">{(entry.components ?? []).map((item) => componentLabels[item] ?? item).join('、') || '未声明'}</DetailField>
        <DetailField label="能力">{entry.capabilities?.join('、') || '未声明'}</DetailField>
        <DetailField label="权限">{entry.permissions.map(pluginPermissionLabel).join('、') || '无额外权限'}</DetailField>
        <DetailField label="数据目标（市场声明）">{entry.dataTargets?.join('、') || inferDataTargets(entry.permissions)}</DetailField>
      </div>
      {!!entry.categories.length && <div className="mt-4 flex flex-wrap gap-2">{entry.categories.map((item) => <span key={item} className="rounded-full bg-bg-active px-2 py-1 text-[14px] text-txt-muted">{item}</span>)}</div>}
      {entry.changelog && <section className="mt-6"><h3 className="text-[14px] font-semibold">更新记录</h3><p className="mt-2 whitespace-pre-wrap text-[14px] leading-5 text-txt-muted">{entry.changelog}</p></section>}
      {risk.mode === 'update' && <section className={`mt-6 rounded-xl border p-4 text-[14px] ${risk.requiresFreshApproval ? 'border-amber-500/40 bg-amber-950/20' : 'border-border'}`}>
        <h3 className="font-semibold text-txt-primary">从 {installed?.version ?? '未知版本'} 更新</h3>
        {risk.addedPermissions.length > 0 && <p className="mt-2 text-amber-300">新增权限：{risk.addedPermissions.map(pluginPermissionLabel).join('、')}</p>}
        {risk.sourceChanged && <p className="mt-2 text-amber-300">插件来源已变化</p>}
        {risk.signingChanged && <p className="mt-2 text-amber-300">发布者签名已变化</p>}
        {risk.publisherUnknown && <p className="mt-2 text-amber-300">无法确认已安装版本的发布者签名</p>}
        {!risk.requiresFreshApproval && <p className="mt-2 text-txt-muted">未发现新增权限或发布者变化。</p>}
      </section>}
      {entry.sha256 && <p className="mt-5 break-all font-mono text-[14px] text-txt-muted">SHA-256 {entry.sha256}</p>}
      {entry.repository && <p className="mt-2 break-all font-mono text-[14px] text-txt-muted">固定版本 {entry.repository.ref.slice(0, 12)}</p>}
      <p className="mt-5 text-[14px] leading-5 text-txt-muted">安装或更新会校验内容，完成后插件保持禁用，需由你检查后启用。</p>
      <div className="sticky bottom-0 mt-7 flex justify-end gap-2 border-t border-border bg-bg-panel py-4"><Button onClick={onClose}>取消</Button>
        <Button variant="primary" disabled={mutating || entry.installable === false || risk.mode === 'installed' || risk.mode === 'older'} onClick={onConfirm}>{mutating ? '处理中…' : action}</Button></div>
    </aside>
  </div>
}

function DetailField({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return <div><div className="text-[14px] text-txt-muted">{label}</div><div className="mt-1 text-txt-secondary">{children}</div></div>
}

function sourceKindLabel(kind: PluginMarketEntry['sourceKind']): string {
  return kind === 'official' ? '官方' : kind === 'github' ? 'GitHub' : '社区'
}

function compatibilityLabel(entry: PluginMarketEntry): string {
  const platforms = entry.platforms.length ? entry.platforms.join(' / ') : '所有平台'
  const architectures = entry.architectures.length ? entry.architectures.join(' / ') : '所有架构'
  return `${platforms} · ${architectures}${entry.minAppVersion ? ` · 应用 ≥ ${entry.minAppVersion}` : ''}`
}

function inferDataTargets(permissions: PluginPermission[]): string {
  const targets = new Set<string>()
  if (permissions.some((item) => item.startsWith('workspace.'))) targets.add('当前项目')
  if (permissions.includes('network')) targets.add('外部网络')
  if (permissions.some((item) => item.startsWith('browser.'))) targets.add('已连接浏览器页面')
  if (permissions.includes('process')) targets.add('本机进程')
  return [...targets].join('、') || '未声明'
}

function PluginSourcesView(): JSX.Element {
  const sources = usePluginStore((state) => state.marketSources)
  const addSource = usePluginStore((state) => state.addSource)
  const syncSource = usePluginStore((state) => state.syncSource)
  const setSourceEnabled = usePluginStore((state) => state.setSourceEnabled)
  const removeSource = usePluginStore((state) => state.removeSource)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [keyId, setKeyId] = useState('')
  const [publicKey, setPublicKey] = useState('')
  return <section className="mt-7">
    <div className="rounded-xl border border-border bg-bg-panel p-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="sm:w-40"><TextInput aria-label="市场源名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="市场源名称" block /></div>
        <div className="min-w-0 flex-1"><TextInput aria-label="市场源地址" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…/index.json" block /></div>
        <Button disabled={!name.trim() || !url.trim() || Boolean(keyId.trim()) !== Boolean(publicKey.trim())} onClick={() => void addSource(name, url, keyId.trim() || undefined, publicKey.trim() || undefined).then((ok) => { if (ok) { setName(''); setUrl(''); setKeyId(''); setPublicKey('') } })}>添加</Button>
      </div>
      <details className="mt-3 text-[14px] text-txt-muted"><summary className="cursor-pointer">可选：固定发布者签名公钥</summary>
        <div className="mt-2 grid gap-2"><TextInput aria-label="签名密钥标识" value={keyId} onChange={(event) => setKeyId(event.target.value)} placeholder="密钥标识（与公钥同时填写）" block />
          <TextArea aria-label="Ed25519 签名公钥" rows={4} autoSize={false} className="min-h-24 resize-y font-mono" value={publicKey} onChange={(event) => setPublicKey(event.target.value)} placeholder="-----BEGIN PUBLIC KEY-----" /></div>
      </details>
    </div>
    <div className="mt-4 border-t border-border">{sources.map((source) => <article key={source.id} className="flex flex-wrap items-center gap-3 border-b border-border py-3">
      <div className="min-w-[180px] flex-1"><div className="text-[14px] text-txt-primary">{source.name} <span className="text-[14px] text-txt-muted">{source.kind}</span>{source.verified && <span className="ml-1 text-[14px] text-accent">已验证</span>}{source.signingKeyId && <span className="ml-1 text-[14px] text-accent">签名已固定</span>}</div><div className="truncate text-[14px] text-txt-muted">{source.url}</div>{source.error && <div className="text-[14px] text-red-300">{source.error}</div>}</div>
      <Button size="sm" variant="text" onClick={() => void syncSource(source.id)}>同步</Button>
      {source.kind !== 'official' && <Button size="sm" variant="text" onClick={() => void setSourceEnabled(source.id, !source.enabled)}>{source.enabled ? '禁用' : '启用'}</Button>}
      {/*
        * 文档 8.7：危险操作要有明确的 danger 语义，不能只靠红字。
        * Button variant="danger" 同时提供危险态样式与语义，点击区域也回到控件级尺寸。
        */}
      {source.kind !== 'official' && <Button size="sm" variant="danger" onClick={() => void removeSource(source.id)}>删除</Button>}
    </article>)}</div>
    {!sources.length && <EmptySkills label="还没有市场源；添加 HTTPS 索引地址后可手动同步" />}
  </section>
}

export function filterPlugins(items: PluginMetadata[], query: string): PluginMetadata[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return items.filter((plugin) => !normalizedQuery ||
    `${plugin.name} ${plugin.description} ${plugin.author ?? ''}`.toLocaleLowerCase().includes(normalizedQuery))
}

function PluginRow({ plugin, marketEntry, onToggle, onRecover }: {
  plugin: PluginMetadata; marketEntry?: PluginMarketEntry; onToggle: (next: boolean) => void; onRecover: () => void
}): JSX.Element {
  const badges = plugin.permissions.slice(0, 2).map(pluginPermissionLabel)
  const uninstall = usePluginStore((state) => state.uninstall)
  const loadBackups = usePluginStore((state) => state.loadBackups)
  const rollback = usePluginStore((state) => state.rollback)
  const connection = usePluginStore((state) => state.connections.find((item) => item.pluginId === plugin.id))
  const mutatingConnection = usePluginStore((state) => state.mutatingConnection)
  const connectMcp = usePluginStore((state) => state.connectMcp)
  const reauthorizeMcp = usePluginStore((state) => state.reauthorizeMcp)
  const retryMcp = usePluginStore((state) => state.retryMcp)
  const disconnectMcp = usePluginStore((state) => state.disconnectMcp)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [backups, setBackups] = useState<import('@shared/types').PluginBackup[]>()
  const toggleBackups = async (): Promise<void> => {
    if (backups !== undefined) { setBackups(undefined); return }
    setBackups(await loadBackups(plugin.id))
  }
  return <article className="border-b border-border py-2.5">
    <div className="flex min-h-[46px] items-center gap-2.5">
      <PluginLogo entry={marketEntry} invalid={plugin.status !== 'ready'} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="truncate text-[14px] font-medium text-txt-primary">{plugin.name}</strong>
          {plugin.version && <span className="text-[14px] tabular-nums text-txt-muted">{plugin.version}</span>}
          {plugin.status === 'invalid' && <span className="text-[14px] text-err">清单无效</span>}
          {plugin.status === 'quarantined' && <span className="text-[14px] text-warn">已隔离</span>}
          {plugin.managed && <span className="text-[14px] text-accent">受管</span>}
          <span className="text-[14px] text-txt-muted">{plugin.installOrigin?.sourceName ?? '来源未知'}</span>
        </div>
        {/*
         * 描述对读屏与页面检索保持可读，但不再占用可见的两行高度 ——
         * Codex 的已安装列表是紧凑图标行，长描述会显著拉高每一行。
         */}
        <p className="sr-only">{plugin.description}</p>
        {/* 错误必须可见（有测试锁定诊断信息） */}
        {plugin.errors[0] && <p className="mt-0.5 truncate text-[14px] leading-4 text-err">{plugin.errors[0]}</p>}
        {/* 权限与能力改为紧凑文本，替代原先一排 chip */}
        {!!badges.length && <p className="mt-0.5 truncate text-[14px] text-txt-muted">{badges.join(' · ')}</p>}
      </div>
      {plugin.status === 'quarantined' ? <Button size="sm" className="shrink-0" onClick={onRecover}>恢复</Button>
        : /* 启用与否是标准开关语义：角色 switch + aria-checked，不再用图标自绘 */
        <ToggleSwitch size="small" className="shrink-0" aria-label={plugin.enabled ? `禁用 ${plugin.name}` : `启用 ${plugin.name}`}
          checked={plugin.enabled} disabled={plugin.status !== 'ready'} onChange={onToggle} />}
      {!plugin.managed && <IconButton size="sm" className="shrink-0" danger active={confirmRemove} icon={<Icon.Trash size={14} />} label="卸载" onClick={() => setConfirmRemove((open) => !open)} />}
      <IconButton size="sm" className="shrink-0" active={backups !== undefined} aria-expanded={backups !== undefined}
        icon={<Icon.ChevronDown size={14} className={`transition-transform ${backups !== undefined ? 'rotate-180' : ''}`} />} label="历史版本" onClick={() => void toggleBackups()} />
    </div>
  </article>
}

export function PluginConnectionPanel({ pluginId, server, mutating, onConnect, onReauthorize, onRetry, onDisconnect }: {
  pluginId: string
  server: PluginMcpServerView
  mutating: boolean
  onConnect: (input: PluginMcpConnectInput) => Promise<boolean> | void
  onReauthorize: (input: PluginMcpConnectInput) => Promise<boolean> | void
  onRetry: (input: { pluginId: string; serverId: string }) => Promise<boolean> | void
  onDisconnect: (input: { connectionId: string }) => Promise<boolean> | void
}): JSX.Element {
  const [credential, setCredential] = useState('')
  const [accountLabel, setAccountLabel] = useState('')
  const [existingId, setExistingId] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const target = { pluginId, serverId: server.id }
  const submit = async (reauthorize = false): Promise<void> => {
    const action = reauthorize ? onReauthorize : onConnect
    const ok = await action({
      ...target,
      ...(existingId && !reauthorize ? { connectionId: existingId } : {}),
      ...(credential ? { credential } : {}),
      ...(accountLabel.trim() ? { accountLabel: accountLabel.trim() } : {})
    })
    if (ok !== false) { setCredential(''); setAccountLabel(''); setExistingId('') }
  }
  const status = mcpStateLabel(server.state)
  return <section className="rounded-lg border border-border bg-bg-raised px-3 py-2.5 text-[14px]">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`h-1.5 w-1.5 rounded-full ${server.state === 'connected' ? 'bg-emerald-400' : server.state === 'failed' ? 'bg-red-400' : server.state === 'restricted' ? 'bg-amber-400' : 'bg-txt-muted'}`} />
      <span className="font-medium text-txt-secondary">{server.serverOrigin}</span>
      <span className="text-txt-muted">{mcpAuthLabel(server.auth)}</span>
      <span className="ml-auto text-txt-muted">{status}</span>
    </div>
    {server.accountLabel && <p className="mt-1 text-txt-muted">账号：{server.accountLabel}</p>}
    {server.state === 'restricted' && <p className="mt-2 text-amber-300">启用插件并授予联网权限后才能连接</p>}
    {server.state === 'failed' && <div className="mt-2 flex items-center justify-between gap-3"><span className="text-red-300">连接失败{server.errorCode ? `（${mcpErrorLabel(server.errorCode)}）` : ''}</span>
      <Button size="sm" variant="text" disabled={mutating} onClick={() => void onRetry(target)}>重试</Button></div>}
    {server.state === 'pending' && !server.connectionId && <div className="mt-2 grid gap-2">
      {!!server.compatibleConnections.length && <SelectControl
        aria-label="绑定已有连接"
        value={existingId || undefined}
        onChange={(value) => setExistingId(value == null ? '' : String(value))}
        placeholder="创建新连接"
        options={[
          { value: '', label: '创建新连接' },
          ...server.compatibleConnections.map((item) => ({ value: item.id, label: item.accountLabel ?? item.serverOrigin }))
        ]}
        block
      />}
      {!existingId && server.auth === 'api-key' && <TextInput type="password" aria-label="API Key" autoComplete="off" value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="API Key" block />}
      {!existingId && <TextInput aria-label="账号标签（可选）" value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} placeholder="账号标签（可选）" block />}
      <Button className="justify-self-start" variant="primary" disabled={mutating || (!existingId && server.auth === 'api-key' && !credential)} onClick={() => void submit()}>{mutating ? '连接中…' : server.auth === 'oauth2' ? '在浏览器中授权' : existingId ? '绑定连接' : '连接账号'}</Button>
    </div>}
    {server.state === 'pending' && server.connectionId && <div className="mt-2 grid gap-2">
      <p className="text-amber-300">需要重新授权</p>
      {server.auth === 'api-key' && <TextInput type="password" aria-label="新的 API Key" autoComplete="off" value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="新的 API Key" block />}
      <Button className="justify-self-start" disabled={mutating || (server.auth === 'api-key' && !credential)} onClick={() => void submit(true)}>{server.auth === 'oauth2' ? '在浏览器中重新授权' : '重新授权'}</Button>
    </div>}
    {server.state === 'connected' && server.auth !== 'none' && <div className="mt-2 flex flex-wrap justify-end gap-3">
      <details className="text-right"><summary className="cursor-pointer list-none text-txt-secondary [&::-webkit-details-marker]:hidden">重新授权</summary>
        <div className="mt-2 flex flex-wrap justify-end gap-2">{server.auth === 'api-key' && <div className="w-52"><TextInput type="password" aria-label="新的 API Key" autoComplete="off" value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="新的 API Key" block /></div>}
          <Button disabled={mutating || (server.auth === 'api-key' && !credential)} onClick={() => void submit(true)}>{server.auth === 'oauth2' ? '在浏览器中重新授权' : '确认重新授权'}</Button></div></details></div>}
    {server.connectionId && <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
      {!confirmDisconnect ? <Button size="sm" variant="danger" onClick={() => setConfirmDisconnect(true)}>断开</Button>
        : <span className="flex items-center gap-2"><span className="text-txt-muted">将同时断开共享此账号的插件</span><Button size="sm" variant="danger" disabled={mutating || !server.connectionId} onClick={() => server.connectionId && void onDisconnect({ connectionId: server.connectionId })}>确认断开</Button><Button size="sm" variant="text" onClick={() => setConfirmDisconnect(false)}>取消</Button></span>}
    </div>}
  </section>
}

function mcpStateLabel(state: PluginMcpServerView['state']): string {
  return ({ pending: '待连接', connected: '已连接', failed: '连接失败', restricted: '权限受限' })[state]
}
function mcpAuthLabel(auth: PluginMcpServerView['auth']): string {
  return auth === 'api-key' ? 'API Key' : auth === 'oauth2' ? 'OAuth' : '无需登录'
}
function mcpErrorLabel(code: string): string {
  return ({ MCP_UNAUTHORIZED: '需要重新授权', MCP_FORBIDDEN: '账号权限不足', MCP_NETWORK_BLOCKED: '网络目标受限', MCP_CONNECT_FAILED: '服务暂不可用' } as Record<string, string>)[code] ?? '请稍后重试'
}

export function PluginUninstallChoices({ onChoose, onCancel, showHint = true }: {
  onChoose: (dataDisposition: 'keep' | 'clear') => void
  onCancel: () => void
  showHint?: boolean
}): JSX.Element {
  return <span className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-[14px]">
    {showHint && <span className="w-full text-right text-txt-muted">审计记录会保留</span>}
    <Button size="sm" variant="text" onClick={() => onChoose('keep')}>卸载并保留数据</Button>
    {/* 清除数据不可撤销（文档 8.7）：用 danger 语义而不是红字 */}
    <Button size="sm" variant="danger" onClick={() => onChoose('clear')}>卸载并清除数据</Button>
    <Button size="sm" variant="text" onClick={onCancel}>取消</Button>
  </span>
}

function PluginLogo({ entry, size = 'md', invalid = false }: {
  entry?: PluginMarketEntry
  size?: 'md' | 'lg'
  invalid?: boolean
}): JSX.Element {
  const light = useThemeStore((state) => state.resolved.light)
  const src = (light ? entry?.logoUrl : entry?.logoDarkUrl ?? entry?.logoUrl) ?? entry?.composerIconUrl
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const dimension = size === 'lg' ? 'h-11 w-11 rounded-lg' : 'h-8 w-8 rounded-md'
  const iconSize = size === 'lg' ? 19 : 15
  /*
   * 只保留一层中性底，不加任何边框或描边（用户要求去掉多余外框）。
   *
   * 这层底不是装饰而是可见性必需：实测 20 个官方 logo 中 12 个是
   * 近白色字形（亮度 216-255），若容器完全透明，浅色模式下会直接消失；
   * 且 logoDark 变体只有 9/57 覆盖，换图兜不住。
   */
  return <span
    className={`flex shrink-0 items-center justify-center overflow-hidden ${dimension} ${
      invalid ? 'bg-bg-raised text-err' : 'bg-surface-raised text-txt-secondary'
    }`}
  >
    {src && !failed
      ? <img src={src} alt="" className="h-full w-full object-contain" onError={() => setFailed(true)} />
      : <Icon.Container size={iconSize} />}
  </span>
}

function pluginPermissionLabel(permission: PluginPermission): string {
  return ({
    'workspace.read': '项目读取', 'workspace.write': '项目写入', network: '联网', process: '运行命令',
    'browser.read': '浏览器读取', 'browser.interact': '浏览器交互'
  } as Record<PluginPermission, string>)[permission]
}

export function SecuritySection(): JSX.Element {
  const [message, setMessage] = useState('')
  const [clearing, setClearing] = useState(false)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loadingAudit, setLoadingAudit] = useState(true)
  const [auditError, setAuditError] = useState('')
  useEffect(() => {
    let active = true
    void window.agent.settings.getAudit().then((result) => {
      if (!active) return
      if (result.ok) setEvents(result.data)
      else setAuditError(result.error.message)
      setLoadingAudit(false)
    })
    return () => { active = false }
  }, [])
  const clearAudit = async (): Promise<void> => {
    setClearing(true)
    setMessage('')
    const result = await window.agent.settings.clearAudit()
    setClearing(false)
    if (result.ok) {
      setEvents([])
      setMessage('审计记录已清除')
    } else setMessage(result.error.message)
  }
  return <div>
    <h1 className="selectable text-[20px] font-semibold text-txt-primary">安全与数据</h1>
    <p className="mt-1 text-[14px] text-txt-muted">管理本机保存的安全记录。</p>
    <Group title="审计记录">
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="text-[14px] font-medium text-txt-primary">操作审计</div>
          <p className="mt-1 max-w-[480px] text-[14px] leading-5 text-txt-muted">仅保存操作类型、结果和脱敏后的目标摘要，用于排查权限与执行问题。</p>
        </div>
        <Button className="shrink-0" disabled={clearing} onClick={() => void clearAudit()}>
          {clearing ? '清除中…' : '清除审计记录'}
        </Button>
      </div>
      {message && <p role="status" className="mt-3 text-[14px] text-txt-secondary">{message}</p>}
      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 text-[14px] font-medium text-txt-secondary">近期记录（最多 100 条）</div>
        {loadingAudit ? <p className="text-[14px] text-txt-muted">正在读取审计记录…</p>
          : auditError ? <p role="alert" className="text-[14px] text-red-300">{auditError}</p>
            : <AuditRecordList events={events} />}
      </div>
    </Group>
  </div>
}

export function AuditRecordList({ events }: { events: AuditEvent[] }): JSX.Element {
  if (!events.length) return <p className="text-[14px] text-txt-muted">暂无审计记录</p>
  return <ol className="space-y-2">
    {events.map((event) => {
      const category = auditCategory(event)
      return <li key={event.id} className="rounded-lg border border-border bg-bg-app px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className={`rounded px-1.5 py-0.5 ${category.tone}`}>{category.label}</span>
          <span className="font-medium text-txt-secondary">{auditOutcomeLabel(event.outcome)}</span>
          <time className="ml-auto text-txt-muted" dateTime={new Date(event.timestamp).toISOString()}>{new Date(event.timestamp).toLocaleString('zh-CN')}</time>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[14px] text-txt-muted">
          <span>{event.reasonCode ?? event.action}</span>
          {event.pluginId && <span>{event.pluginId}{event.pluginVersion ? `@${event.pluginVersion}` : ''}</span>}
          {event.toolName && <span>{event.toolName}</span>}
          {event.approvalScope && <span>范围：{auditScopeLabel(event.approvalScope)}</span>}
        </div>
      </li>
    })}
  </ol>
}

function auditCategory(event: AuditEvent): { label: string; tone: string } {
  const evidence = `${event.action} ${event.reasonCode ?? ''}`.toLowerCase()
  if (/isolat|quarant/.test(evidence)) return { label: '隔离', tone: 'bg-red-500/15 text-red-300' }
  if (/connection|connect|oauth/.test(evidence)) return { label: '连接', tone: 'bg-cyan-500/15 text-cyan-300' }
  if (/updat|rollback|install|uninstall/.test(evidence)) return { label: '更新', tone: 'bg-amber-500/15 text-amber-300' }
  if (/start|launch/.test(evidence)) return { label: '启动', tone: 'bg-orange-500/15 text-orange-300' }
  if (/approval|permission|policy|denied/.test(evidence)) return { label: '权限', tone: 'bg-accent-dim/25 text-accent' }
  return { label: '执行', tone: 'bg-bg-raised text-txt-muted' }
}

function auditOutcomeLabel(outcome: AuditEvent['outcome']): string {
  return ({ allow: '允许', ask: '等待审批', deny: '已拒绝', success: '成功', failure: '失败', cancelled: '已取消' } as const)[outcome]
}

function auditScopeLabel(scope: NonNullable<AuditEvent['approvalScope']>): string {
  return ({ once: '仅本次', 'task-prefix': '本任务相同命令', site: '此网站' } as const)[scope]
}

export function SkillsSection(): JSX.Element {
  const activeId = useSessionStore((state) => state.activeId)
  const projectPath = useSessionStore((state) => state.sessions.find((session) => session.id === activeId)?.projectPath)
  const workspaceId = useWorkspaceStore((state) => state.recent.find((workspace) => workspace.displayPath === projectPath)?.id)
  const items = useSkillStore((state) => state.items)
  const catalog = useSkillStore((state) => state.catalog)
  const loading = useSkillStore((state) => state.loading)
  const mutating = useSkillStore((state) => state.mutating)
  const error = useSkillStore((state) => state.error)
  const load = useSkillStore((state) => state.load)
  const loadCatalog = useSkillStore((state) => state.loadCatalog)
  const install = useSkillStore((state) => state.install)
  const importLocal = useSkillStore((state) => state.importLocal)
  const uninstall = useSkillStore((state) => state.uninstall)
  const setEnabled = useSkillStore((state) => state.setEnabled)
  const createSession = useSessionStore((state) => state.create)
  const closeSettings = useUiStore((state) => state.closeSettings)
  const setPendingPrompt = useUiStore((state) => state.setPendingPrompt)
  const [tab, setTab] = useState<'installed' | 'market'>('installed')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'all' | SkillSource>('all')
  const [githubUrl, setGithubUrl] = useState('')
  const [expandedId, setExpandedId] = useState<string>()
  /** 市场条目的详情弹窗（与已安装技能分开管理） */
  const [pendingCatalog, setPendingCatalog] = useState<SkillCatalogItem>()
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDetailsElement>(null)
  const closeAddMenu = (): void => {
    if (addMenuRef.current) addMenuRef.current.open = false
    setAddMenuOpen(false)
  }
  useDismissibleLayer(addMenuRef, addMenuOpen, closeAddMenu)
  useEffect(() => { void load(workspaceId); void loadCatalog() }, [load, loadCatalog, workspaceId])
  useEffect(() => {
    if (tab !== 'market') return
    const timer = setTimeout(() => { void loadCatalog(query) }, 250)
    return () => clearTimeout(timer)
  }, [tab, query, loadCatalog])
  /*
   * 「立即试用」：新建（或复用空）会话 → 回到对话页 → 预填 /技能名。
   * 技能在本项目里就是用 /名称 调用的，因此预填与既有调用方式一致；
   * 刻意不自动发送，避免「点一下就替用户发消息」。
   */
  const trySkill = (skill: SkillMetadata): void => {
    const command = `/${skill.name} `
    setExpandedId(undefined)
    setPendingPrompt(command)
    closeSettings()
    void createSession()
  }

  const activeSkill = items.find((skill) => skill.id === expandedId)
  const visibleItems = items.filter((skill) => (source === 'all' || skill.source === source) &&
    (!query || `${skill.name} ${skill.displayName} ${skill.description}`.toLowerCase().includes(query.toLowerCase())))
  return <div>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="selectable text-[20px] font-semibold text-txt-primary">技能</h1>
        <p className="mt-1 text-[14px] text-txt-muted">通过任务专用技能扩展 AI 的能力</p>
      </div>
      <details ref={addMenuRef} onToggle={(event) => setAddMenuOpen(event.currentTarget.open)} className="group relative z-20">
        {/*
          * 这里是原生 <details>/<summary>（展开行为由浏览器提供），
          * 不能换成 Button：按钮放进 summary 会破坏原生开合语义与键盘操作。
          * 因此保留 summary，只把 .btn 工具类摊开成等价工具类，去掉旧类依赖。
          */}
        <summary aria-haspopup="menu" aria-expanded={addMenuOpen} className="inline-flex min-h-9 cursor-pointer list-none items-center justify-center gap-1.5 rounded-lg border border-border bg-bg-raised px-3 py-1.5 text-[14px] font-medium text-txt-secondary transition-colors hover:border-border-strong hover:bg-bg-active hover:text-txt-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          添加 <Icon.ChevronDown size={12} className="transition-transform group-open:rotate-180" />
        </summary>
        <div hidden={!addMenuOpen} role="menu" style={{ backgroundColor: 'var(--surface-overlay)' }} className="absolute right-0 top-full z-40 mt-2 w-[min(380px,calc(100vw-2rem))] rounded-xl border border-border-strong bg-surface-overlay p-2 shadow-overlay">
          <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] text-txt-secondary hover:bg-bg-active"
            disabled={mutating} onClick={() => { closeAddMenu(); void importLocal() }}>
            <Icon.Folder size={14} className="text-txt-muted" />
            <span><strong className="block font-medium text-txt-primary">从本机导入</strong><span className="text-[14px] text-txt-muted">选择 Skill 或 Skill Pack 目录</span></span>
          </button>
          <div className="my-1 border-t border-border" />
          <div className="px-3 py-1 text-[14px] text-txt-muted">从 GitHub 地址添加</div>
          <div className="flex gap-1.5 px-1 pb-1">
            <div className="min-w-0 flex-1"><TextInput aria-label="GitHub 地址" value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)}
              placeholder="https://github.com/owner/repo" block /></div>
            <Button className="shrink-0" variant="primary"
              disabled={mutating || !githubUrl.trim()} onClick={() => void install(githubUrl.trim()).then((ok) => { if (ok) { setGithubUrl(''); closeAddMenu() } })}>
              {mutating ? '添加中…' : '添加'}
            </Button>
          </div>
        </div>
      </details>
    </div>
    <div className="mt-6 flex items-center gap-6 border-b border-border">
      <button className={`-mb-px border-b-2 pb-2.5 text-[14px] font-medium ${tab === 'installed' ? 'border-accent text-txt-primary' : 'border-transparent text-txt-muted hover:text-txt-secondary'}`} onClick={() => setTab('installed')}>已安装</button>
      <button className={`-mb-px border-b-2 pb-2.5 text-[14px] font-medium ${tab === 'market' ? 'border-accent text-txt-primary' : 'border-transparent text-txt-muted hover:text-txt-secondary'}`} onClick={() => setTab('market')}>技能市场</button>
    </div>
    <div className="mt-5 flex flex-col gap-2 sm:flex-row">
      <div className="min-w-0 flex-1">
        <TextInput aria-label="搜索技能" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索技能" prefix={<Icon.Search size={14} className="text-txt-muted" />} allowClear className="rounded-full bg-bg-raised" block />
      </div>
      {tab === 'installed' && <div className="w-full sm:w-[124px]"><SelectControl<string>
        aria-label="筛选 Skill 来源"
        value={source}
        onChange={(value) => setSource(value as 'all' | SkillSource)}
        options={[
          { value: 'all', label: '全部来源' },
          { value: 'project', label: '项目' },
          { value: 'installed', label: '应用安装' },
          { value: 'codex', label: 'Codex' },
          { value: 'agents', label: 'Agents' },
          { value: 'plugin', label: '插件' },
          { value: 'builtin', label: '内置' }
        ]}
        block
      /></div>}
    </div>
    {error && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[14px] text-red-300">{error}</div>}
    {tab === 'installed' ? <section className="mt-7">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[14px] font-semibold text-txt-primary">已安装</h2>
        <span className="text-[14px] tabular-nums text-txt-muted">{visibleItems.length}</span>
      </div>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-x-4">
        {visibleItems.map((skill) => <InstalledSkillRow key={skill.id} skill={skill}
          onExpand={() => setExpandedId(skill.id)} />)}
      </div>
      {!loading && !visibleItems.length && <EmptySkills label="没有找到已安装的 Skill" />}
      {activeSkill && <SkillDetails skill={activeSkill} mutating={mutating}
        onClose={() => setExpandedId(undefined)}
        onToggle={(next) => void setEnabled(activeSkill.id, next)}
        onUpdate={() => { if (activeSkill.installUrl) void install(activeSkill.installUrl) }}
        onUninstall={() => void uninstall(activeSkill.id).then((ok) => { if (ok) setExpandedId(undefined) })}
        onTry={() => trySkill(activeSkill)} />}
    </section> : <section className="mt-7">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[14px] font-semibold text-txt-primary">技能市场</h2>
        <span className="text-[14px] tabular-nums text-txt-muted">{catalog.length}</span>
      </div>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-x-4">
        {catalog.map((skill) => <MarketSkillRow key={skill.id} skill={skill} mutating={mutating}
          onOpen={() => setPendingCatalog(skill)}
          onInstall={() => void install(skill.installUrl)} />)}
      </div>
      {!loading && !catalog.length && <EmptySkills label="没有找到匹配的 Skill" />}
      {pendingCatalog && <MarketSkillDetails skill={pendingCatalog} mutating={mutating}
        onClose={() => setPendingCatalog(undefined)}
        onInstall={() => void install(pendingCatalog.installUrl)} />}
    </section>}
    <p className="mt-8 border-t border-border pt-4 text-[14px] leading-5 text-txt-muted">
      项目与 Codex/Agents 目录只读发现；第三方 Skill 不会自动执行脚本，也不能提升工具权限。输入 <code>/</code> 调用。
    </p>
  </div>
}

/**
 * 市场技能详情弹窗。
 *
 * 与已安装技能的弹窗差异（按用户要求）：
 * - 未安装时**不展示启用开关** —— 还没有可切换的启用状态；
 * - 未安装时右下角是「添加」而不是「立即试用」；
 * - 已安装时展示「已添加」并禁用，避免重复添加。
 *
 * 市场条目是 SkillCatalogItem，字段比已安装技能少（无工具/资源等），
 * 因此只呈现真实存在的字段。
 */
function MarketSkillDetails({ skill, mutating, onClose, onInstall }: {
  skill: SkillCatalogItem
  mutating: boolean
  onClose: () => void
  onInstall: () => void
}): JSX.Element {
  const dialog = useRef<HTMLDivElement | null>(null)
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onMouseDown={onClose}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="market-skill-title" tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
        else if (dialog.current) trapPluginDialogFocus(event, dialog.current as unknown as DialogFocusRoot)
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className="my-auto w-full max-w-[560px] rounded-xl border border-border bg-bg-panel p-5 shadow-2xl">
      <div className="flex items-center gap-3">
        <SkillGlyph />
        <div className="min-w-0 flex-1">
          <h2 id="market-skill-title" className="flex items-center gap-2 text-[17px] font-semibold text-txt-primary">
            {skill.displayName}
            {skill.featured && <span className="text-[14px] font-normal text-accent">推荐</span>}
          </h2>
          <p className="mt-1 text-[14px] leading-5 text-txt-secondary">{skill.description}</p>
        </div>
        <IconButton autoFocus className="mt-2" icon={<Icon.X size={16} />} label="关闭技能详情" onClick={onClose} />
      </div>
      <div className="mt-5 grid gap-3 rounded-xl bg-bg-raised p-4 text-[14px] sm:grid-cols-2">
        <DetailField label="发布者">{skill.publisher || '未声明'}</DetailField>
        <DetailField label="仓库">{skill.repository}</DetailField>
        <DetailField label="安装状态">{skill.installed ? '已添加' : '未添加'}</DetailField>
      </div>
      <p className="mt-4 break-all font-mono text-[14px] text-txt-muted">{skill.installUrl}</p>
      <p className="mt-4 text-[14px] leading-5 text-txt-muted">第三方 Skill 不会自动执行脚本，也不能提升工具权限。</p>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <Button size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" variant="primary" disabled={mutating || skill.installed} onClick={onInstall}>
          {skill.installed ? '已添加' : '添加'}
        </Button>
      </div>
    </div>
  </div>
}

/**
 * 技能详情弹窗。
 *
 * 说明：Codex 的详情里还包含技能正文（完整指令），但本项目的
 * `SkillMetadata` 只暴露 description 等元数据，正文未走 IPC，
 * 因此这里只呈现真实可用的字段，不展示占位或编造内容。
 */
function SkillDetails({ skill, mutating, onClose, onToggle, onUpdate, onUninstall, onTry }: {
  skill: SkillMetadata
  mutating: boolean
  onClose: () => void
  onToggle: (next: boolean) => void
  onUpdate: () => void
  onUninstall: () => void
  onTry: () => void
}): JSX.Element {
  const dialog = useRef<HTMLDivElement | null>(null)
  const sourceLabel = skillSourceLabel(skill.source)
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onMouseDown={onClose}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="skill-detail-title" tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
        else if (dialog.current) trapPluginDialogFocus(event, dialog.current as unknown as DialogFocusRoot)
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className="my-auto w-full max-w-[560px] rounded-xl border border-border bg-bg-panel p-5 shadow-2xl">
      <div className="flex items-start gap-3">
        <SkillGlyph muted={!skill.active} />
        <div className="min-w-0 flex-1">
          <h2 id="skill-detail-title" className="text-[17px] font-semibold text-txt-primary">{skill.displayName} Skill</h2>
          <p className="mt-1 text-[14px] leading-5 text-txt-secondary">{skill.description}</p>
        </div>
        {/* 启用开关：按 Codex 放在右上角（与关闭按钮同加 8px，保持同一水平线） */}
        <ToggleSwitch size="small" className="mt-2 shrink-0"
          aria-label={skill.enabled ? `禁用 ${skill.displayName}` : `启用 ${skill.displayName}`}
          checked={skill.enabled} disabled={Boolean(skill.errors.length)} onChange={onToggle} />
        <IconButton autoFocus icon={<Icon.X size={16} />} label="关闭技能详情" onClick={onClose} />
      </div>
      <div className="mt-5 grid gap-3 rounded-xl bg-bg-raised p-4 text-[14px] sm:grid-cols-2">
        <DetailField label="来源">{sourceLabel}</DetailField>
        <DetailField label="触发方式">{skill.invocation === 'user' ? '仅快捷指令' : '可自动触发'}</DetailField>
        <DetailField label="工具策略">{skill.toolPolicy === 'inherit' ? '沿用任务工具' : `声明 ${skill.allowedTools.length} 个工具`}</DetailField>
        <DetailField label="状态">{skill.errors.length ? '加载失败' : skill.enabled ? '已启用' : '已禁用'}</DetailField>
        {skill.version && <DetailField label="版本">{skill.version.slice(0, 12)}</DetailField>}
        {skill.repository && <DetailField label="仓库">{skill.repository}</DetailField>}
      </div>
      {!!skill.allowedTools.length && <section className="mt-4">
        <h3 className="text-[14px] font-medium text-txt-secondary">可用工具</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">{skill.allowedTools.map((tool) => <span key={tool} className="rounded bg-bg-raised px-2 py-0.5 font-mono text-[14px] text-txt-muted">{tool}</span>)}</div>
      </section>}
      {!!skill.resources.length && <section className="mt-4">
        <h3 className="text-[14px] font-medium text-txt-secondary">资源</h3>
        <div className="mt-2 space-y-1">{skill.resources.map((resource) => <p key={resource} className="break-all text-[14px] text-txt-muted">{resource}</p>)}</div>
      </section>}
      {skill.shadowedBy && <p className="mt-4 text-[14px] text-warn">已被高优先级同名项覆盖</p>}
      {skill.errors.map((message) => <p key={message} className="mt-4 text-[14px] text-err">{message}</p>)}
      <p className="mt-4 text-[14px] leading-5 text-txt-muted">第三方 Skill 不会自动执行脚本，也不能提升工具权限。</p>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {skill.source === 'installed' && skill.installUrl && <Button size="sm" variant="text" disabled={mutating} onClick={onUpdate}>检查更新</Button>}
        {skill.source === 'installed' && <Button size="sm" variant="danger" disabled={mutating} onClick={onUninstall}>卸载</Button>}
        <Button size="sm" variant="primary" onClick={onTry}>立即试用</Button>
      </div>
    </div>
  </div>
}

/**
 * 已安装技能行：整行即按钮，点击打开详情弹窗（对齐 Codex）。
 *
 * 行上刻意不放启用开关或技术元数据：
 * - 启用状态在详情弹窗右上角（Codex 的做法）；
 * - 工具、资源、错误等只在弹窗里出现，列表保持纯浏览。
 */
function InstalledSkillRow({ skill, onExpand }: {
  skill: SkillMetadata
  onExpand: () => void
}): JSX.Element {
  return <article className={`rounded-lg transition-colors hover:bg-bg-active ${skill.errors.length ? 'text-err' : ''}`}>
    <button type="button" className="flex min-h-[58px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left"
      aria-label={`查看技能 ${skill.displayName} 详情`} onClick={onExpand}>
      <SkillGlyph muted={!skill.active} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <strong className="truncate text-[14px] font-medium text-txt-primary">{skill.displayName}</strong>
          {skill.invocation === 'user' && <span className="shrink-0 text-[14px] text-txt-muted">/{skill.name}</span>}
        </span>
        <span className="mt-1 block truncate text-[14px] leading-5 text-txt-muted">{skill.description}</span>
      </span>
    </button>
  </article>
}

/**
 * 技能市场行。
 *
 * 整行主体（图标/名称/描述/发布者）可点开详情弹窗；
 * 右侧的添加按钮是**兄弟节点**而不是嵌套在按钮内 ——
 * 嵌套会造成「按钮里套按钮」的无效结构与键盘焦点问题。
 */
function MarketSkillRow({ skill, mutating, onInstall, onOpen }: {
  skill: SkillCatalogItem
  mutating: boolean
  onInstall: () => void
  onOpen: () => void
}): JSX.Element {
  return <article className="flex min-h-[58px] items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-bg-active">
    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left"
      aria-label={`查看技能 ${skill.displayName} 详情`} onClick={onOpen}>
      <SkillGlyph />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <strong className="truncate text-[14px] font-medium text-txt-primary">{skill.displayName}</strong>
          {skill.featured && <span className="shrink-0 text-[14px] text-accent">推荐</span>}
        </span>
        <span className="mt-1 block truncate text-[14px] leading-5 text-txt-muted">{skill.description}</span>
        <span className="mt-0.5 block truncate text-[14px] text-txt-muted">{skill.publisher}</span>
      </span>
    </button>
    <IconButton size="sm" className="shrink-0" label={skill.installed ? '已添加' : '添加'} disabled={mutating || skill.installed}
      icon={skill.installed ? <Icon.Check size={14} /> : <Icon.Plus size={14} />} onClick={onInstall} />
  </article>
}

function SkillGlyph({ muted = false }: { muted?: boolean }): JSX.Element {
  return <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-raised ${muted ? 'opacity-55' : ''}`}>
    <span className="h-3.5 w-3.5 rotate-45 rounded-[3px] bg-gradient-to-br from-amber-300 via-rose-400 to-violet-500 shadow-sm" aria-hidden="true" />
  </span>
}

function EmptySkills({ label }: { label: string }): JSX.Element {
  return <div className="py-14 text-center text-[14px] text-txt-muted">{label}</div>
}

function skillSourceLabel(source: import('@shared/types').SkillSource): string {
  if (source === 'project') return '项目'
  if (source === 'installed') return '已安装'
  if (source === 'codex') return 'Codex'
  if (source === 'agents') return 'Agents'
  if (source === 'plugin') return '插件'
  return '内置'
}

function NavItem({
  active,
  label,
  onClick,
  icon
}: {
  active: boolean
  label: string
  onClick: () => void
  icon: JSX.Element
}): JSX.Element {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-[14px] transition-colors',
        active
          ? 'bg-bg-active font-medium text-txt-primary'
          : 'text-txt-secondary hover:bg-bg-raised hover:text-txt-primary'
      ].join(' ')}
    >
      <span className={active ? 'text-accent' : 'text-txt-muted'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  )
}

/**
 * @deprecated 旧的分组容器。已由全局 FormSection 取代，
 * 保留同名别名是为了让尚未迁移的调用点继续工作。
 */
const Group = FormSection

/**
 * 旧的表单说明标签。新代码请直接用 SettingRow 的 label，
 * 这里保留是为了让尚未迁移的区域继续可用。
 */
function Label({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mb-2 text-[14px] leading-[22px] text-txt-secondary">{children}</div>
}

/**
 * 旧的「标签 + 控件」组合。
 * 已改为基于 SettingRow，宽度、分隔线与纵向堆叠跟随全局规范。
 */
/**
 * 表单字段：标签在上、控件在下。
 *
 * 模型编辑表单里的控件都是输入框，用 stacked 对齐更稳定；
 * inline 会让「标签—控件」的水平间距随标签长度变化而不齐，
 * 在宽窗口下显得松散。
 */
function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <SettingRow label={label} layout="stacked">
      {children}
    </SettingRow>
  )
}

/* ---------------- 主题 ---------------- */

function ThemeSection(): JSX.Element {
  const mode = useThemeStore((s) => s.mode)
  const overrides = useThemeStore((s) => s.overrides)
  const resolved = useThemeStore((s) => s.resolved)
  const setMode = useThemeStore((s) => s.setMode)
  const setBg = useThemeStore((s) => s.setBg)
  const setText = useThemeStore((s) => s.setText)
  const setAccent = useThemeStore((s) => s.setAccent)
  const resetOverrides = useThemeStore((s) => s.resetOverrides)

  const hasOverride = !!(overrides.bg || overrides.text || overrides.accent)

  return (
    <>
      <h1 className="selectable text-[20px] font-semibold text-txt-primary">外观</h1>
      <p className="mt-1 text-[14px] leading-[22px] text-txt-muted">
        主题默认跟随操作系统；也可以固定为浅色或深色，并单独调整背景、文字与强调色。
      </p>

      <div className="space-y-5">
        {/* 主题模式不套外框：三张卡片直接落在页面上（对齐 Codex） */}
        <section className="mt-5">
          <h2 className="text-[16px] font-medium leading-6 text-txt-primary">主题模式</h2>
          <p className="mt-0.5 text-[14px] leading-[22px] text-txt-muted">
            选择整体外观。跟随系统时，系统切换深浅色会实时生效。
          </p>
          <div className="mt-3">
            <ThemeModeCards
              value={mode}
              onChange={setMode}
              systemDark={resolveTheme({ mode: 'system' }).isDark}
            />
          </div>
        </section>

        <FormSection
          title="自定义颜色"
          description="背景色是整体系统色；文字色与强调色可分别自定义。输入合法 HEX 并回车或失焦后生效。"
          extra={
            hasOverride ? (
              <TagChip tone="accent" variant="filled">
                已自定义
              </TagChip>
            ) : undefined
          }
        >
          <ColorField
            label="背景色"
            value={overrides.bg ?? resolved.color.surface.app}
            onApply={setBg}
            first
          />
          <ColorField
            label="文字颜色"
            value={overrides.text ?? resolved.color.text.primary}
            onApply={setText}
          />
          <ColorField
            label="强调色"
            value={overrides.accent ?? resolved.color.accent.primary}
            onApply={setAccent}
          />
          <SettingRow label="恢复默认" description="清除全部自定义颜色，回到当前模式的基线配色。">
            <Button variant="text" disabled={!hasOverride} onClick={resetOverrides}>
              恢复默认
            </Button>
          </SettingRow>
        </FormSection>
      </div>
    </>
  )
}

function ColorField({
  label,
  value,
  onApply,
  first = false
}: {
  label: string
  value: string
  onApply: (hex: string) => void
  first?: boolean
}): JSX.Element {
  const [text, setText] = useState(value)
  /* 仅外部变化（模式切换 / 已提交）时同步，避免输入过程跳动 */
  useEffect(() => setText(value), [value])

  const valid = normalizeHexColor(text) != null
  const commit = (): void => {
    const hex = normalizeHexColor(text)
    if (hex) onApply(hex)
    else setText(value)
  }

  return (
    <SettingRow
      label={label}
      first={first}
      layout="stacked"
      description={valid ? undefined : '请输入合法的 HEX 颜色，例如 #4d6bfe'}
    >
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onApply(event.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-transparent"
          aria-label={`${label}选择器`}
        />
        <TextInput
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
          status={valid ? undefined : 'error'}
          className="font-mono"
          spellCheck={false}
          aria-label={label}
        />
      </div>
    </SettingRow>
  )
}

/* ---------------- 模型 ---------------- */

export function ModelSection(): JSX.Element {
  const config = useModelStore((s) => s.config)
  const load = useModelStore((s) => s.load)
  const save = useModelStore((s) => s.save)
  const activate = useModelStore((s) => s.activate)
  const test = useModelStore((s) => s.test)
  const [editing, setEditing] = useState<ModelPreset | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  const startNew = (): void => {
    setEditing({
      id: '',
      name: '',
      provider: 'deepseek',
      baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
      apiKey: '',
      model: PROVIDER_PRESETS.deepseek.model,
      capabilities: { imageInput: false },
      contextMessages: 50,
      contextTokens: 128000
    })
    setIsNew(true)
  }
  const startEdit = (p: ModelPreset): void => {
    setEditing({ ...p })
    setIsNew(false)
  }

  const commit = async (): Promise<void> => {
    if (!config || !editing) return
    const draft: ModelPreset = {
      ...editing,
      id: editing.id || crypto.randomUUID(),
      name: editing.name || editing.model
    }
    const presets = isNew
      ? [...config.presets, draft]
      : config.presets.map((x) => (x.id === draft.id ? draft : x))
    const r = await save({ presets, activePresetId: config.activePresetId })
    if (r) {
      setMsg('已保存')
      setEditing(null)
    } else setMsg('保存失败')
  }

  const remove = async (id: string): Promise<void> => {
    if (!config) return
    const presets = config.presets.filter((x) => x.id !== id)
    const activePresetId = config.activePresetId === id ? (presets[0]?.id ?? '') : config.activePresetId
    await save({ presets, activePresetId })
  }

  const doTest = async (p: ModelPreset): Promise<void> => {
    setMsg('测试中...')
    const t = await test(p)
    setMsg(t ? (t.success ? `✅ ${t.message}` : `❌ ${t.message}`) : '测试失败')
  }

  if (editing) {
    const set = (patch: Partial<ModelPreset>): void =>
      setEditing((current) => (current ? { ...current, ...patch } : current))

    return (
      <>
        <h1 className="selectable text-[20px] font-semibold text-txt-primary">模型设置</h1>
        <FormSection title={isNew ? '新增模型' : '编辑模型'}>
          <div className="space-y-1">
            <Field label="名称">
              <TextInput
                aria-label="模型名称"
                value={editing.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="如 DeepSeek / Kimi / 我的模型"
                block
              />
            </Field>

            <SettingRow label="提供方" description="选择提供方会自动填入推荐的接入地址与模型名。" block>
              <SegmentedControl<ModelProvider>
                value={editing.provider}
                aria-label="模型提供方"
                onChange={(p) => {
                  set({ provider: p })
                  if (p !== 'custom') {
                    set({
                      baseUrl: PROVIDER_PRESETS[p].baseUrl,
                      model: PROVIDER_PRESETS[p].model
                    })
                  }
                }}
                options={[
                  { value: 'deepseek', label: 'DeepSeek' },
                  { value: 'kimi', label: 'Kimi' },
                  { value: 'custom', label: '自定义' }
                ]}
              />
            </SettingRow>

            <Field label="Base URL">
              <TextInput
                aria-label="Base URL"
                className="font-mono"
                value={editing.baseUrl}
                onChange={(e) => set({ baseUrl: e.target.value })}
                placeholder="https://.../v1"
                block
              />
            </Field>

            <Field label="API Key">
              <div>
                <TextInput
                  aria-label="API Key"
                  className="font-mono"
                  type="password"
                  value={editing.apiKey}
                  onChange={(e) =>
                    set({ apiKey: e.target.value, hasApiKey: e.target.value ? true : editing.hasApiKey })
                  }
                  placeholder={editing.hasApiKey ? '已安全保存；留空保持不变' : 'sk-...'}
                  block
                />
                {editing.hasApiKey && !editing.apiKey && (
                  <Button
                    variant="text"
                    size="sm"
                    className="mt-1"
                    onClick={() => set({ hasApiKey: false, apiKey: '' })}
                  >
                    清除已保存的密钥
                  </Button>
                )}
              </div>
            </Field>

            <Field label="模型">
              <div>
                <TextInput
                  aria-label="模型标识"
                  className="font-mono"
                  value={editing.model}
                  onChange={(e) => set({ model: e.target.value })}
                  placeholder="deepseek-chat / moonshot-v1-8k"
                  block
                />
                <p className="mt-1.5 text-[14px] leading-[22px] text-txt-muted">
                  图片能力由该模型本身决定。如需识图，请新增一个多模态模型预设，并在对话中切换后发送图片。
                </p>
              </div>
            </Field>

            <SettingRow label="图片输入" description="该模型是否接受图片作为输入。">
              <ToggleSwitch
                checked={editing.capabilities?.imageInput ?? false}
                aria-label="支持图片输入"
                onChange={(checked) => set({ capabilities: { imageInput: checked } })}
              />
            </SettingRow>

            <p className="py-3 text-[14px] leading-[22px] text-txt-muted">
              多轮记忆和上下文长度由应用按厂商与模型能力自动管理。
            </p>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button variant="primary" onClick={() => void commit()}>保存</Button>
            <Button onClick={() => void doTest(editing)}>测试连接</Button>
            <Button variant="text" onClick={() => setEditing(null)}>取消</Button>
            {msg && <span className="text-[14px] text-txt-secondary">{msg}</span>}
          </div>
        </FormSection>
      </>
    )
  }

  return (
    <>
      <h1 className="selectable text-[20px] font-semibold text-txt-primary">模型设置</h1>
      <FormSection title="已配置的模型" description="对话输入框下方可快速切换当前模型。">
        <div className="flex flex-col gap-2">
          {(config?.presets ?? []).map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-app px-3 py-2"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-accent-contrast">
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[14px] text-txt-primary">
                  <span className="truncate">{p.name}</span>
                  <TagChip>{p.provider}</TagChip>
                  <TagChip>联网自动</TagChip>
                </div>
                <div className="truncate text-[14px] text-txt-muted">{p.model}</div>
              </div>
              {p.id === config?.activePresetId && (
                <TagChip tone="accent" variant="filled">
                  当前
                </TagChip>
              )}
              <IconButton
                icon={<Icon.Check size={14} />}
                label="设为当前"
                disabled={p.id === config?.activePresetId}
                onClick={() => void activate(p.id)}
              />
              <IconButton icon={<Icon.Edit size={14} />} label="编辑" onClick={() => startEdit(p)} />
              <IconButton icon={<Icon.Play size={14} />} label="测试" onClick={() => void doTest(p)} />
              <IconButton
                icon={<Icon.Trash size={14} />}
                label="删除"
                danger
                onClick={() => void remove(p.id)}
              />
            </div>
          ))}
          <Button block onClick={startNew} icon={<Icon.Plus size={14} />}>
            新增模型
          </Button>
        </div>
        {msg && <div className="mt-3 text-[14px] text-txt-secondary">{msg}</div>}
      </FormSection>
      <FormSection title="说明">
        <p className="text-[14px] leading-[22px] text-txt-secondary">
          可配置多个模型端点，对话输入框下方可通过下拉快速切换，并选择「低 / 中 / 高」推理等级。联网检索无需单独开关：普通问答会自动向模型提供厂商搜索能力；项目编码任务仍优先使用项目工具。自定义端点不兼容 Responses web_search 时会自动回退普通回答。未配置时回退本地演示（Mock）。
        </p>
      </FormSection>
    </>
  )
}

