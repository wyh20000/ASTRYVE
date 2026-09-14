import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { useThemeStore } from '../../stores/themeStore'
import { useModelStore } from '../../stores/modelStore'
import { THEMES, getTheme, normalizeHex, type ThemePreset } from '../../theme/theme'
import type { ModelProvider, ModelConfig, ModelPreset, PluginMarketEntry, PluginMetadata, PluginPermission, SkillCatalogItem, SkillMetadata, SkillSource } from '@shared/types'
import { Icon } from '../ui/icons'
import { useSkillStore } from '../../stores/skillStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { AgentSettingsSection } from '../chat/AgentControls'
import { usePluginStore } from '../../stores/pluginStore'
import { compareSemver } from '@shared/semver'
import type { AuditEvent } from '@shared/agent'

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

  return (
    <div className="flex min-h-0 flex-1 bg-bg-app text-txt-primary">
      <div className="flex w-[164px] shrink-0 flex-col border-r border-border bg-bg-panel sm:w-[200px]">
        <div className="flex h-12 items-center gap-2 px-3">
          <button className="btn-icon" title="返回" onClick={closeSettings}>
            <Icon.X size={15} />
          </button>
          <span className="text-[14px] font-semibold text-txt-primary">设置</span>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Icon.Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-muted" />
            <input placeholder="搜索设置项..." className="input h-7 pl-7 text-[12px]" />
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          <NavItem active={section === 'theme'} icon={<Icon.Settings size={14} />} label="主题设置" onClick={() => setSection('theme')} />
          <NavItem active={section === 'model'} icon={<Icon.Brain size={14} />} label="模型设置" onClick={() => setSection('model')} />
          <NavItem active={section === 'agent'} icon={<Icon.Shield size={14} />} label="Agent 设置" onClick={() => setSection('agent')} />
          <NavItem active={section === 'extensions'} icon={<Icon.FileDir size={14} />} label="插件" onClick={() => setSection('extensions')} />
          <NavItem active={section === 'security'} icon={<Icon.Shield size={14} />} label="安全与数据" onClick={() => setSection('security')} />
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
    className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${active ? 'bg-bg-active text-txt-primary' : 'text-txt-muted hover:bg-bg-raised hover:text-txt-secondary'}`}
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
  useEffect(() => { void load(); void loadPreferences(); if (loadMarketplace) void loadMarketplace() }, [load, loadMarketplace, loadPreferences])
  const filtered = filterPlugins(items, query)
  return <div>
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-[220px] flex-1">
        <h1 className="selectable text-[22px] font-semibold tracking-tight text-txt-primary">插件</h1>
        <p className="mt-1 text-[12px] text-txt-muted">在你常用的工具中与 AI Agent 协作</p>
      </div>
      <details className="group relative shrink-0">
        <summary className="btn flex cursor-pointer list-none items-center gap-1 rounded-lg border border-border bg-bg-raised px-3 py-1.5 text-[12px] text-txt-secondary hover:bg-bg-active [&::-webkit-details-marker]:hidden">
          {mutating ? '处理中…' : '添加'} <Icon.ChevronDown size={12} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="absolute right-0 top-full z-20 mt-1.5 w-[min(240px,calc(100vw-2rem))] rounded-xl border border-border bg-bg-panel p-2 shadow-2xl">
          <button type="button" disabled={mutating} onClick={() => void importLocal('directory')}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-txt-secondary hover:bg-bg-active disabled:opacity-50">
            <Icon.Folder size={14} className="text-txt-muted" /> 导入文件夹
          </button>
          <button type="button" disabled={mutating} onClick={() => void importLocal('zip')}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-txt-secondary hover:bg-bg-active disabled:opacity-50">
            <Icon.File size={14} className="text-txt-muted" /> 导入 ZIP
          </button>
        </div>
      </details>
    </div>
    <div role="tablist" aria-label="插件页面" className="mt-6 flex gap-6 border-b border-border">
      {([['installed', '已安装'], ['market', '插件市场'], ['sources', '市场源'], ['developer', '开发者']] as const).map(([id, label]) =>
        <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}
          className={`-mb-px border-b-2 pb-2.5 text-[12px] ${view === id ? 'border-accent text-txt-primary' : 'border-transparent text-txt-muted hover:text-txt-secondary'}`}>{label}</button>)}
    </div>
    <div className="relative mt-6">
      <Icon.Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-muted" />
      <input aria-label="搜索插件" className="input h-9 rounded-full border-border bg-bg-raised pl-9 text-[12px]"
        value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索插件" />
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-950/30 px-3 py-2 text-[11px] text-red-300">{error}</p>}
    {view === 'installed' && <section className="mt-7">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <h2 className="text-[13px] font-semibold text-txt-primary">已安装</h2>
        <span className="text-[10px] tabular-nums text-txt-muted">{items.length}</span>
        <label title="仅限同一来源和发布者、没有新增权限的更高版本；应用启动时检查" className="ml-auto flex cursor-pointer items-center gap-2 text-[10px] text-txt-muted">
          <input type="checkbox" checked={preferences.autoUpdate} onChange={(event) => void setAutoUpdate(event.target.checked)} />
          自动安装安全更新
        </label>
      </div>
      {filtered.map((plugin) => <PluginRow key={plugin.id} plugin={plugin}
        onToggle={() => void setEnabled(plugin.id, !plugin.enabled)}
        onRecover={() => void recover(plugin.id)} />)}
      {!loading && !filtered.length && <div className="flex min-h-[220px] flex-col items-center justify-center px-4 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-raised text-txt-muted">
          <Icon.FileDir size={18} />
        </span>
        <h3 className="mt-4 text-[13px] font-medium text-txt-primary">{items.length ? '没有找到匹配的插件' : '尚未安装插件'}</h3>
        <p className="mt-1 max-w-[360px] text-[11px] leading-5 text-txt-muted">
          {items.length ? '请尝试其他关键词。' : '点击“添加”可安全导入文件夹或 ZIP；导入后默认禁用。'}
        </p>
      </div>}
    </section>}
    {view === 'market' && <PluginMarketView entries={marketEntries} installed={items} query={query} />}
    {view === 'sources' && <PluginSourcesView />}
    {view === 'developer' && <section className="mt-7 rounded-xl border border-border bg-bg-panel p-5">
      <h2 className="text-[13px] font-semibold">开发者</h2>
      <p className="mt-2 text-[11px] leading-5 text-txt-muted">使用 plugin.json 声明工具、权限和入口。开发包仍需经过相同的路径、大小、schema 与权限校验；本地导入不会自动启用。</p>
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
  const [category, setCategory] = useState('all')
  const [pending, setPending] = useState<PluginMarketEntry>()
  const opener = useRef<HTMLElement | null>(null)
  const categories = listMarketplaceCategories(entries)
  const visible = latestMarketplaceEntries(filterMarketplaceEntries(entries, { scope, category, query }))
  const openDetails = (entry: PluginMarketEntry, element: HTMLElement): void => { opener.current = element; setPending(entry) }
  const closeDetails = (): void => { setPending(undefined); queueMicrotask(() => opener.current?.focus()) }
  return <section className="mt-7">
    <div className="flex flex-wrap gap-2" role="group" aria-label="市场范围">
      {([['recommended', '推荐'], ['official', '官方'], ['community', '社区'], ['all', '全部']] as const).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={scope === id} onClick={() => setScope(id)} className={`rounded-full px-3 py-1.5 text-[10px] ${scope === id ? 'bg-accent-dim text-accent' : 'bg-bg-raised text-txt-muted'}`}>{label}</button>)}
    </div>
    {!!categories.length && <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="插件分类">
      {['all', ...categories].map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`shrink-0 text-[10px] ${category === item ? 'text-txt-primary' : 'text-txt-muted'}`}>{item === 'all' ? '全部分类' : item}</button>)}
    </div>}
    <div className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">{visible.map((entry) => <article key={`${entry.sourceId}:${entry.id}:${entry.version}`} className="border-b border-border py-4">
      <div className="flex items-start gap-3"><SkillGlyph /><div className="min-w-0 flex-1">
        <button type="button" className="block w-full text-left" onClick={(event) => openDetails(entry, event.currentTarget)} aria-label={`查看 ${entry.name} 详情`}><div className="flex flex-wrap items-center gap-1.5"><strong className="text-[12px]">{entry.name}</strong><span className="text-[9px] text-txt-muted">{entry.version}</span>{entry.verified && <span className="text-[9px] text-accent">已验证</span>}</div>
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-txt-muted">{entry.description}</p>
        <p className="mt-1 text-[9px] text-txt-muted">{entry.author} · {entry.sourceName} · {entry.permissions.length} 项权限</p></button>
        {entry.installable === false && <p className="mt-1 text-[9px] text-amber-300">{entry.unavailableReason}</p>}
      </div><MarketActionButton entry={entry} installed={installed.find((item) => item.id === entry.id)} releases={entries} mutating={mutating} onOpen={openDetails} /></div>
    </article>)}</div>
    {!visible.length && <EmptySkills label={entries.length ? '没有符合当前筛选条件的插件' : '正在同步 Codex 官方市场；也可以在“市场源”添加其他来源'} />}
    {pending && <PluginMarketDetails entry={pending} installed={installed.find((item) => item.id === pending.id)} releases={entries}
      mutating={mutating} onClose={closeDetails} onConfirm={() => void install(pending.sourceId, pending.id, pending.version).then((ok) => { if (ok) closeDetails() })} />}
  </section>
}

function MarketActionButton({ entry, installed, releases, mutating, onOpen }: {
  entry: PluginMarketEntry; installed?: PluginMetadata; releases: PluginMarketEntry[]; mutating: boolean
  onOpen: (entry: PluginMarketEntry, element: HTMLElement) => void
}): JSX.Element {
  const risk = describePluginInstallRisk(entry, installed, releases)
  const label = entry.installable === false ? '待支持' : risk.mode === 'installed' ? '已安装' : risk.mode === 'older' ? '版本较旧' : risk.mode === 'update' ? '更新' : '安装'
  return <button type="button" title={entry.unavailableReason} disabled={entry.installable === false || risk.mode === 'installed' || risk.mode === 'older' || mutating}
    onClick={(event) => onOpen(entry, event.currentTarget)} className="rounded-full bg-bg-raised px-3 py-1.5 text-[10px] text-txt-secondary disabled:text-txt-muted">{label}</button>
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
      <div className="flex items-start gap-4"><SkillGlyph /><div className="min-w-0 flex-1"><h2 id="plugin-detail-title" className="text-[17px] font-semibold">{entry.name}</h2>
        <p className="mt-1 text-[10px] text-txt-muted">{entry.author} · {entry.sourceName} · {entry.version}</p></div>
        <button type="button" autoFocus aria-label="关闭插件详情" onClick={onClose} className="btn-icon text-lg text-txt-muted">×</button></div>
      <p className="mt-5 text-[12px] leading-6 text-txt-secondary">{entry.description}</p>
      <div className="mt-5 grid gap-3 rounded-xl bg-bg-raised p-4 text-[11px] sm:grid-cols-2">
        <DetailField label="来源">{sourceKindLabel(entry.sourceKind)}{entry.verified ? ' · 已验证' : ' · 未验证'}</DetailField>
        <DetailField label="兼容性">{compatibilityLabel(entry)}</DetailField>
        <DetailField label="组件">{(entry.components ?? []).map((item) => componentLabels[item] ?? item).join('、') || '未声明'}</DetailField>
        <DetailField label="能力">{entry.capabilities?.join('、') || '未声明'}</DetailField>
        <DetailField label="权限">{entry.permissions.map(pluginPermissionLabel).join('、') || '无额外权限'}</DetailField>
        <DetailField label="数据目标（市场声明）">{entry.dataTargets?.join('、') || inferDataTargets(entry.permissions)}</DetailField>
      </div>
      {!!entry.categories.length && <div className="mt-4 flex flex-wrap gap-2">{entry.categories.map((item) => <span key={item} className="rounded-full bg-bg-active px-2 py-1 text-[9px] text-txt-muted">{item}</span>)}</div>}
      {entry.changelog && <section className="mt-6"><h3 className="text-[12px] font-semibold">更新记录</h3><p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-txt-muted">{entry.changelog}</p></section>}
      {risk.mode === 'update' && <section className={`mt-6 rounded-xl border p-4 text-[11px] ${risk.requiresFreshApproval ? 'border-amber-500/40 bg-amber-950/20' : 'border-border'}`}>
        <h3 className="font-semibold text-txt-primary">从 {installed?.version ?? '未知版本'} 更新</h3>
        {risk.addedPermissions.length > 0 && <p className="mt-2 text-amber-300">新增权限：{risk.addedPermissions.map(pluginPermissionLabel).join('、')}</p>}
        {risk.sourceChanged && <p className="mt-2 text-amber-300">插件来源已变化</p>}
        {risk.signingChanged && <p className="mt-2 text-amber-300">发布者签名已变化</p>}
        {risk.publisherUnknown && <p className="mt-2 text-amber-300">无法确认已安装版本的发布者签名</p>}
        {!risk.requiresFreshApproval && <p className="mt-2 text-txt-muted">未发现新增权限或发布者变化。</p>}
      </section>}
      {entry.sha256 && <p className="mt-5 break-all font-mono text-[9px] text-txt-muted">SHA-256 {entry.sha256}</p>}
      {entry.repository && <p className="mt-2 break-all font-mono text-[9px] text-txt-muted">固定版本 {entry.repository.ref.slice(0, 12)}</p>}
      <p className="mt-5 text-[10px] leading-5 text-txt-muted">安装或更新会校验内容，完成后插件保持禁用，需由你检查后启用。</p>
      <div className="sticky bottom-0 mt-7 flex justify-end gap-2 border-t border-border bg-bg-panel py-4"><button type="button" className="btn px-3 text-[11px]" onClick={onClose}>取消</button>
        <button type="button" disabled={mutating || entry.installable === false || risk.mode === 'installed' || risk.mode === 'older'} className="btn bg-accent px-3 text-[11px] text-white disabled:opacity-50" onClick={onConfirm}>{mutating ? '处理中…' : action}</button></div>
    </aside>
  </div>
}

function DetailField({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return <div><div className="text-[9px] text-txt-muted">{label}</div><div className="mt-1 text-txt-secondary">{children}</div></div>
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
        <input aria-label="市场源名称" className="input h-9 sm:w-40" value={name} onChange={(event) => setName(event.target.value)} placeholder="市场源名称" />
        <input aria-label="市场源地址" className="input h-9 min-w-0 flex-1" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…/index.json" />
        <button className="btn bg-bg-raised px-3 text-[11px]" disabled={!name.trim() || !url.trim() || Boolean(keyId.trim()) !== Boolean(publicKey.trim())} onClick={() => void addSource(name, url, keyId.trim() || undefined, publicKey.trim() || undefined).then((ok) => { if (ok) { setName(''); setUrl(''); setKeyId(''); setPublicKey('') } })}>添加</button>
      </div>
      <details className="mt-3 text-[10px] text-txt-muted"><summary className="cursor-pointer">可选：固定发布者签名公钥</summary>
        <div className="mt-2 grid gap-2"><input aria-label="签名密钥标识" className="input h-8" value={keyId} onChange={(event) => setKeyId(event.target.value)} placeholder="密钥标识（与公钥同时填写）" />
          <textarea aria-label="Ed25519 签名公钥" className="input min-h-24 resize-y font-mono text-[9px]" value={publicKey} onChange={(event) => setPublicKey(event.target.value)} placeholder="-----BEGIN PUBLIC KEY-----" /></div>
      </details>
    </div>
    <div className="mt-4 border-t border-border">{sources.map((source) => <article key={source.id} className="flex flex-wrap items-center gap-3 border-b border-border py-3">
      <div className="min-w-[180px] flex-1"><div className="text-[12px] text-txt-primary">{source.name} <span className="text-[9px] text-txt-muted">{source.kind}</span>{source.verified && <span className="ml-1 text-[9px] text-accent">已验证</span>}{source.signingKeyId && <span className="ml-1 text-[9px] text-accent">签名已固定</span>}</div><div className="truncate text-[9px] text-txt-muted">{source.url}</div>{source.error && <div className="text-[10px] text-red-300">{source.error}</div>}</div>
      <button className="text-[10px] text-txt-secondary" onClick={() => void syncSource(source.id)}>同步</button>
      {source.kind !== 'official' && <button className="text-[10px] text-txt-secondary" onClick={() => void setSourceEnabled(source.id, !source.enabled)}>{source.enabled ? '禁用' : '启用'}</button>}
      {source.kind !== 'official' && <button className="text-[10px] text-red-300" onClick={() => void removeSource(source.id)}>删除</button>}
    </article>)}</div>
    {!sources.length && <EmptySkills label="还没有市场源；添加 HTTPS 索引地址后可手动同步" />}
  </section>
}

export function filterPlugins(items: PluginMetadata[], query: string): PluginMetadata[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return items.filter((plugin) => !normalizedQuery ||
    `${plugin.name} ${plugin.description} ${plugin.author ?? ''}`.toLocaleLowerCase().includes(normalizedQuery))
}

function PluginRow({ plugin, onToggle, onRecover }: {
  plugin: PluginMetadata; onToggle: () => void; onRecover: () => void
}): JSX.Element {
  const badges = plugin.permissions.slice(0, 2).map(pluginPermissionLabel)
  const uninstall = usePluginStore((state) => state.uninstall)
  const loadBackups = usePluginStore((state) => state.loadBackups)
  const rollback = usePluginStore((state) => state.rollback)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [backups, setBackups] = useState<import('@shared/types').PluginBackup[]>()
  const showBackups = async (): Promise<void> => setBackups(await loadBackups(plugin.id))
  return <article className="border-b border-border py-3"><div className="flex min-h-[52px] items-center gap-3">
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${plugin.status === 'ready' ? 'bg-accent-dim text-accent' : 'bg-bg-raised text-red-300'}`}>
      <Icon.FileDir size={16} />
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="truncate text-[12px] font-medium text-txt-primary">{plugin.name}</strong>
        {plugin.version && <span className="text-[9px] text-txt-muted">{plugin.version}</span>}
        {plugin.status === 'invalid' && <span className="text-[9px] text-red-300">清单无效</span>}
        {plugin.status === 'quarantined' && <span className="text-[9px] text-amber-300">已隔离</span>}
        {plugin.managed && <span className="text-[9px] text-accent">受管</span>}<span className="text-[9px] text-txt-muted">{plugin.installOrigin?.sourceName ?? '来源未知'}</span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-txt-muted">{plugin.errors[0] ?? plugin.description}</p>
      {!!badges.length && <div className="mt-1 flex flex-wrap gap-1.5">{badges.map((badge) =>
        <span key={badge} className="rounded bg-bg-raised px-1.5 py-0.5 text-[9px] text-txt-muted">{badge}</span>)}</div>}
    </div>
    {plugin.status === 'quarantined' ? <button type="button" onClick={onRecover}
      className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] text-txt-secondary hover:bg-bg-active">
      恢复
    </button> : <button type="button" aria-label={plugin.enabled ? `禁用 ${plugin.name}` : `启用 ${plugin.name}`}
      disabled={plugin.status !== 'ready'} onClick={onToggle}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${plugin.enabled ? 'text-txt-secondary' : 'text-txt-muted'} disabled:opacity-40`}>
      {plugin.enabled ? <Icon.Check size={14} /> : <span className="h-3 w-3 rounded-full border border-border-strong" />}
    </button>}
    {!plugin.managed && (!confirmRemove ? <button type="button" title="卸载" className="btn-icon shrink-0 text-txt-muted hover:text-red-300" onClick={() => setConfirmRemove(true)}><Icon.Trash size={13} /></button>
      : <PluginUninstallChoices onChoose={(dataDisposition) => void uninstall(plugin.id, dataDisposition)} onCancel={() => setConfirmRemove(false)} />)}
    <button type="button" title="历史版本" className="btn-icon shrink-0 text-txt-muted" onClick={() => void showBackups()}><Icon.ChevronDown size={12} /></button>
  </div>{backups && <div className="ml-12 mt-2 rounded-lg bg-bg-raised px-3 py-2 text-[10px] text-txt-muted">{backups.length ? backups.map((backup) => <div key={backup.version} className="flex items-center justify-between py-1"><span>{backup.version}</span><button className="text-txt-secondary" onClick={() => void rollback(plugin.id, backup.version).then((ok) => { if (ok) setBackups(undefined) })}>回滚</button></div>) : '没有可回滚版本'}</div>}</article>
}

export function PluginUninstallChoices({ onChoose, onCancel }: {
  onChoose: (dataDisposition: 'keep' | 'clear') => void
  onCancel: () => void
}): JSX.Element {
  return <span className="flex max-w-[260px] shrink-0 flex-wrap justify-end gap-x-2 gap-y-1 text-[9px]">
    <span className="w-full text-right text-txt-muted">审计记录会保留</span>
    <button type="button" className="text-txt-secondary" onClick={() => onChoose('keep')}>卸载并保留数据</button>
    <button type="button" className="text-red-300" onClick={() => onChoose('clear')}>卸载并清除数据</button>
    <button type="button" className="text-txt-muted" onClick={onCancel}>取消</button>
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
    <h1 className="selectable text-[18px] font-semibold text-txt-primary">安全与数据</h1>
    <p className="mt-1 text-[12px] text-txt-muted">管理本机保存的安全记录。</p>
    <Group title="审计记录">
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="text-[12px] font-medium text-txt-primary">操作审计</div>
          <p className="mt-1 max-w-[480px] text-[11px] leading-5 text-txt-muted">仅保存操作类型、结果和脱敏后的目标摘要，用于排查权限与执行问题。</p>
        </div>
        <button type="button" className="btn shrink-0 border border-border px-3 py-2 text-[11px] text-txt-secondary hover:bg-bg-active" disabled={clearing} onClick={() => void clearAudit()}>
          {clearing ? '清除中…' : '清除审计记录'}
        </button>
      </div>
      {message && <p role="status" className="mt-3 text-[11px] text-txt-secondary">{message}</p>}
      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 text-[11px] font-medium text-txt-secondary">近期记录（最多 100 条）</div>
        {loadingAudit ? <p className="text-[11px] text-txt-muted">正在读取审计记录…</p>
          : auditError ? <p role="alert" className="text-[11px] text-red-300">{auditError}</p>
            : <AuditRecordList events={events} />}
      </div>
    </Group>
  </div>
}

export function AuditRecordList({ events }: { events: AuditEvent[] }): JSX.Element {
  if (!events.length) return <p className="text-[11px] text-txt-muted">暂无审计记录</p>
  return <ol className="space-y-2">
    {events.map((event) => {
      const category = auditCategory(event)
      return <li key={event.id} className="rounded-lg border border-border bg-bg-app px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className={`rounded px-1.5 py-0.5 ${category.tone}`}>{category.label}</span>
          <span className="font-medium text-txt-secondary">{auditOutcomeLabel(event.outcome)}</span>
          <time className="ml-auto text-txt-muted" dateTime={new Date(event.timestamp).toISOString()}>{new Date(event.timestamp).toLocaleString('zh-CN')}</time>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-txt-muted">
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
  const [tab, setTab] = useState<'installed' | 'market'>('installed')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'all' | SkillSource>('all')
  const [githubUrl, setGithubUrl] = useState('')
  const [expandedId, setExpandedId] = useState<string>()
  useEffect(() => { void load(workspaceId); void loadCatalog() }, [load, loadCatalog, workspaceId])
  useEffect(() => {
    if (tab !== 'market') return
    const timer = setTimeout(() => { void loadCatalog(query) }, 250)
    return () => clearTimeout(timer)
  }, [tab, query, loadCatalog])
  const visibleItems = items.filter((skill) => (source === 'all' || skill.source === source) &&
    (!query || `${skill.name} ${skill.displayName} ${skill.description}`.toLowerCase().includes(query.toLowerCase())))
  return <div>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="selectable text-[22px] font-semibold tracking-tight text-txt-primary">技能</h1>
        <p className="mt-1 text-[12px] text-txt-muted">通过任务专用技能扩展 AI 的能力</p>
      </div>
      <details className="group relative z-20">
        <summary className="btn flex cursor-pointer list-none items-center gap-1 rounded-lg border border-border bg-bg-raised px-3 py-1.5 text-[12px] text-txt-secondary hover:bg-bg-active [&::-webkit-details-marker]:hidden">
          添加 <Icon.ChevronDown size={12} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="absolute right-0 top-full mt-1.5 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border bg-bg-panel p-2 shadow-2xl">
          <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-txt-secondary hover:bg-bg-active"
            disabled={mutating} onClick={() => void importLocal()}>
            <Icon.Folder size={14} className="text-txt-muted" />
            <span><strong className="block font-medium text-txt-primary">从本机导入</strong><span className="text-[10px] text-txt-muted">选择 Skill 或 Skill Pack 目录</span></span>
          </button>
          <div className="my-1 border-t border-border" />
          <div className="px-3 py-1 text-[10px] text-txt-muted">从 GitHub 地址添加</div>
          <div className="flex gap-1.5 px-1 pb-1">
            <input className="input h-8 min-w-0 flex-1 text-[11px]" value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)}
              placeholder="https://github.com/owner/repo" />
            <button className="btn shrink-0 rounded-md bg-accent px-3 text-[11px] text-white disabled:opacity-40"
              disabled={mutating || !githubUrl.trim()} onClick={() => void install(githubUrl.trim()).then((ok) => { if (ok) setGithubUrl('') })}>
              {mutating ? '添加中…' : '添加'}
            </button>
          </div>
        </div>
      </details>
    </div>
    <div className="mt-6 flex items-center gap-6 border-b border-border">
      <button className={`-mb-px border-b-2 pb-2.5 text-[12px] font-medium ${tab === 'installed' ? 'border-accent text-txt-primary' : 'border-transparent text-txt-muted hover:text-txt-secondary'}`} onClick={() => setTab('installed')}>已安装</button>
      <button className={`-mb-px border-b-2 pb-2.5 text-[12px] font-medium ${tab === 'market' ? 'border-accent text-txt-primary' : 'border-transparent text-txt-muted hover:text-txt-secondary'}`} onClick={() => setTab('market')}>技能市场</button>
    </div>
    <div className="mt-5 flex flex-col gap-2 sm:flex-row">
      <div className="relative min-w-0 flex-1">
        <Icon.Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-muted" />
        <input className="input h-9 rounded-full border-border bg-bg-raised pl-9 text-[12px]" value={query}
          onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能" />
      </div>
      {tab === 'installed' && <select aria-label="筛选 Skill 来源" className="input h-9 w-full rounded-full bg-bg-raised px-3 text-[11px] sm:w-[124px]"
        value={source} onChange={(event) => setSource(event.target.value as 'all' | SkillSource)}>
        <option value="all">全部来源</option>
        <option value="project">项目</option>
        <option value="installed">应用安装</option>
        <option value="codex">Codex</option>
        <option value="agents">Agents</option>
        <option value="plugin">插件</option>
        <option value="builtin">内置</option>
      </select>}
    </div>
    {error && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}
    {tab === 'installed' ? <section className="mt-7">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-txt-primary">已安装</h2>
        <span className="text-[10px] tabular-nums text-txt-muted">{visibleItems.length}</span>
      </div>
      <div className="grid grid-cols-1 border-t border-border sm:grid-cols-2 sm:gap-x-8">
        {visibleItems.map((skill) => <InstalledSkillRow key={skill.id} skill={skill} expanded={expandedId === skill.id}
          mutating={mutating} onExpand={() => setExpandedId((current) => current === skill.id ? undefined : skill.id)}
          onToggle={() => void setEnabled(skill.id, !skill.enabled)} onUpdate={() => void install(skill.installUrl!)}
          onUninstall={() => void uninstall(skill.id)} />)}
      </div>
      {!loading && !visibleItems.length && <EmptySkills label="没有找到已安装的 Skill" />}
    </section> : <section className="mt-7">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-txt-primary">技能市场</h2>
        <span className="text-[10px] tabular-nums text-txt-muted">{catalog.length}</span>
      </div>
      <div className="grid grid-cols-1 border-t border-border sm:grid-cols-2 sm:gap-x-8">
        {catalog.map((skill) => <MarketSkillRow key={skill.id} skill={skill} mutating={mutating}
          onInstall={() => void install(skill.installUrl)} />)}
      </div>
      {!loading && !catalog.length && <EmptySkills label="没有找到匹配的 Skill" />}
    </section>}
    <p className="mt-8 border-t border-border pt-4 text-[10px] leading-5 text-txt-muted">
      项目与 Codex/Agents 目录只读发现；第三方 Skill 不会自动执行脚本，也不能提升工具权限。输入 <code>/</code> 调用。
    </p>
  </div>
}

function InstalledSkillRow({ skill, expanded, mutating, onExpand, onToggle, onUpdate, onUninstall }: {
  skill: SkillMetadata
  expanded: boolean
  mutating: boolean
  onExpand: () => void
  onToggle: () => void
  onUpdate: () => void
  onUninstall: () => void
}): JSX.Element {
  return <article className={`border-b border-border py-3 ${skill.errors.length ? 'text-red-300' : ''}`}>
    <div className="flex min-h-[42px] items-center gap-2.5">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={onExpand}>
        <SkillGlyph muted={!skill.active} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <strong className="truncate text-[12px] font-medium text-txt-primary">{skill.displayName}</strong>
            {skill.invocation === 'user' && <span className="shrink-0 text-[9px] text-txt-muted">/{skill.name}</span>}
          </span>
          <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-txt-muted">{skill.description}</span>
        </span>
      </button>
      <button type="button" aria-label={skill.enabled ? `禁用 ${skill.displayName}` : `启用 ${skill.displayName}`}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${skill.enabled ? 'text-txt-secondary' : 'text-txt-muted hover:bg-bg-raised'}`}
        disabled={Boolean(skill.errors.length)} onClick={onToggle}>
        {skill.enabled ? <Icon.Check size={14} /> : <span className="h-3 w-3 rounded-full border border-border-strong" />}
      </button>
    </div>
    {expanded && <div className="ml-9 mt-2 rounded-lg bg-bg-raised px-3 py-2 text-[10px] leading-5 text-txt-muted">
      <div>{skillSourceLabel(skill.source)} · {skill.invocation === 'user' ? '仅快捷指令' : '可自动触发'}</div>
      <div>{skill.toolPolicy === 'inherit' ? '沿用任务工具，仍受权限审批' : `声明 ${skill.allowedTools.length} 个工具，仍受权限审批`}</div>
      {skill.repository && <div>{skill.repository}{skill.version ? ` @ ${skill.version.slice(0, 8)}` : ''}</div>}
      {skill.shadowedBy && <div className="text-warn">已被高优先级同名项覆盖</div>}
      {skill.allowedTools.map((tool) => <div key={tool} className="font-mono">{tool}</div>)}
      {skill.resources.map((resource) => <div key={resource}>资源：{resource}</div>)}
      {skill.errors.map((message) => <div key={message} className="text-red-300">{message}</div>)}
      {skill.source === 'installed' && <div className="mt-2 flex gap-2">
        {skill.installUrl && <button className="text-txt-secondary hover:text-txt-primary" disabled={mutating} onClick={onUpdate}>检查更新</button>}
        <button className="text-red-300/80 hover:text-red-300" disabled={mutating} onClick={onUninstall}>卸载</button>
      </div>}
    </div>}
  </article>
}

function MarketSkillRow({ skill, mutating, onInstall }: { skill: SkillCatalogItem; mutating: boolean; onInstall: () => void }): JSX.Element {
  return <article className="flex min-h-[72px] items-center gap-2.5 border-b border-border py-3">
    <SkillGlyph />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <strong className="truncate text-[12px] font-medium text-txt-primary">{skill.displayName}</strong>
        {skill.featured && <span className="text-[9px] text-accent">推荐</span>}
      </div>
      <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-txt-muted">{skill.description}</p>
      <span className="mt-0.5 block truncate text-[9px] text-txt-muted">{skill.publisher}</span>
    </div>
    <button className={`flex h-7 shrink-0 items-center justify-center rounded-full px-2.5 text-[10px] ${skill.installed ? 'text-txt-muted' : 'bg-bg-raised text-txt-secondary hover:bg-bg-active hover:text-txt-primary'}`}
      disabled={mutating || skill.installed} onClick={onInstall}>{skill.installed ? <Icon.Check size={13} /> : '添加'}</button>
  </article>
}

function SkillGlyph({ muted = false }: { muted?: boolean }): JSX.Element {
  return <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-dim ${muted ? 'text-txt-muted' : 'text-accent'}`}>
    <Icon.Brain size={13} />
  </span>
}

function EmptySkills({ label }: { label: string }): JSX.Element {
  return <div className="py-14 text-center text-[11px] text-txt-muted">{label}</div>
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
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] ${
        active ? 'bg-bg-active text-txt-primary' : 'text-txt-secondary hover:bg-bg-raised'
      }`}
    >
      <span className={active ? 'text-accent' : 'text-txt-muted'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="mt-5 rounded-lg border border-border bg-bg-panel">
      <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold text-txt-primary">
        {title}
      </h2>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

function Label({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mb-2 text-[12px] text-txt-secondary">{children}</div>
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

/* ---------------- 主题 ---------------- */

function ThemeSection(): JSX.Element {
  const presetId = useThemeStore((s) => s.presetId)
  const overrides = useThemeStore((s) => s.overrides)
  const setPreset = useThemeStore((s) => s.setPreset)
  const setBg = useThemeStore((s) => s.setBg)
  const setText = useThemeStore((s) => s.setText)
  const setAccent = useThemeStore((s) => s.setAccent)
  const resetOverrides = useThemeStore((s) => s.resetOverrides)

  const base = getTheme(presetId)
  const hasOverride = !!(overrides.bg || overrides.text || overrides.accent)

  return (
    <>
      <h1 className="selectable text-[18px] font-semibold text-txt-primary">主题设置</h1>
      <Group title="主题外观">
        <Label>应用主题（整体：背景 + 文字 + 强调色）</Label>
        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <ThemeCard
              key={t.id}
              theme={t}
              active={!hasOverride && t.id === presetId}
              onClick={() => setPreset(t.id)}
            />
          ))}
        </div>
        {hasOverride && (
          <button onClick={resetOverrides} className="mt-3 text-[12px] text-accent hover:underline">
            恢复预设主题
          </button>
        )}
      </Group>
      <Group title="自定义颜色">
        <div className="space-y-3">
          <ColorField label="背景色" value={overrides.bg ?? base.bgApp} onApply={setBg} />
          <ColorField label="文字颜色" value={overrides.text ?? base.textPrimary} onApply={setText} />
          <ColorField label="强调色" value={overrides.accent ?? base.accent} onApply={setAccent} />
        </div>
        <p className="mt-3 text-[12px] text-txt-muted">
          背景色是整体系统色；文字色与强调色可分别自定义。输入合法 HEX 并回车/失焦生效，输入什么就是什么。
        </p>
      </Group>
    </>
  )
}

function ThemeCard({
  theme,
  active,
  onClick
}: {
  theme: ThemePreset
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-2.5 rounded-lg border p-3 transition-colors ${
        active ? 'border-accent bg-bg-raised' : 'border-border bg-bg-app hover:border-border-strong'
      }`}
    >
      <div className="h-12 w-24 overflow-hidden rounded-md border border-border" style={{ background: theme.bgApp }}>
        <div className="h-3 w-full" style={{ background: theme.bgPanel }} />
        <div className="space-y-1 p-2">
          <div className="h-1.5 w-12 rounded-sm" style={{ background: theme.textSecondary }} />
          <div className="h-1.5 w-16 rounded-sm" style={{ background: theme.accent }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[12px] text-txt-primary">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: theme.accent }} />
        <span>{theme.name}</span>
        {active && <Icon.Check size={13} className="text-accent" />}
      </div>
    </button>
  )
}

function ColorField({
  label,
  value,
  onApply
}: {
  label: string
  value: string
  onApply: (hex: string) => void
}): JSX.Element {
  const [text, setText] = useState(value)
  // 仅外部变化（预设/已提交）时同步，避免输入过程跳动
  useEffect(() => setText(value), [value])
  const valid = normalizeHex(text) != null
  const commit = (): void => {
    const n = normalizeHex(text)
    if (n) onApply(n)
    else setText(value)
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[12px] text-txt-secondary">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onApply(e.target.value)}
        className="h-9 w-12 cursor-pointer rounded-md border border-border bg-transparent"
        title="选择颜色"
      />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        placeholder="#xxxxxx"
        className={`input w-44 font-mono ${valid ? '' : 'border-warn'}`}
        spellCheck={false}
      />
    </div>
  )
}
/* ---------------- 模型 ---------------- */

function ModelSection(): JSX.Element {
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
    const set = (patch: Partial<ModelPreset>): void => setEditing((e) => (e ? { ...e, ...patch } : e))
    return (
      <>
        <h1 className="selectable text-[18px] font-semibold text-txt-primary">模型设置</h1>
        <Group title={isNew ? '新增模型' : '编辑模型'}>
          <div className="space-y-3">
            <Field label="名称">
              <input className="input" value={editing.name} onChange={(e) => set({ name: e.target.value })} placeholder="如 DeepSeek / Kimi / 我的模型" />
            </Field>
            <Label>提供方</Label>
            <div className="mb-3 flex gap-2">
              {(['deepseek', 'kimi', 'custom'] as ModelProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    set({ provider: p })
                    if (p !== 'custom') {
                      set({
                        baseUrl: PROVIDER_PRESETS[p].baseUrl,
                        model: PROVIDER_PRESETS[p].model
                      })
                    }
                  }}
                  className={`rounded-md border px-3 py-1.5 text-[13px] ${
                    editing.provider === p ? 'border-accent text-txt-primary' : 'border-border text-txt-secondary hover:border-border-strong'
                  }`}
                >
                  {p === 'deepseek' ? 'DeepSeek' : p === 'kimi' ? 'Kimi' : '自定义'}
                </button>
              ))}
            </div>
            <Field label="Base URL">
              <input className="input font-mono" value={editing.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://.../v1" />
            </Field>
            <Field label="API Key">
              <input
                className="input font-mono"
                type="password"
                value={editing.apiKey}
                onChange={(e) => set({ apiKey: e.target.value, hasApiKey: e.target.value ? true : editing.hasApiKey })}
                placeholder={editing.hasApiKey ? '已安全保存；留空保持不变' : 'sk-...'}
              />
              {editing.hasApiKey && !editing.apiKey && (
                <button
                  className="mt-1 text-[11px] text-txt-muted hover:text-warn"
                  onClick={() => set({ hasApiKey: false, apiKey: '' })}
                >
                  清除已保存的密钥
                </button>
              )}
            </Field>
            <Field label="模型">
              <input className="input font-mono" value={editing.model} onChange={(e) => set({ model: e.target.value })} placeholder="deepseek-chat / moonshot-v1-8k" />
              <p className="mt-1.5 text-[11px] leading-relaxed text-txt-muted">
                图片能力由该模型本身决定。如需识图，请新增一个多模态模型预设，并在对话中切换后发送图片。
              </p>
            </Field>
            <label className="flex items-center gap-2 text-[12px] text-txt-secondary">
              <input
                type="checkbox"
                checked={editing.capabilities?.imageInput ?? false}
                onChange={(e) => set({ capabilities: { imageInput: e.target.checked } })}
              />
              此模型支持图片输入
            </label>
            <p className="text-[11px] leading-relaxed text-txt-muted">
              多轮记忆和上下文长度由应用按厂商与模型能力自动管理。
            </p>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => void commit()} className="btn border border-border bg-bg-raised px-3 py-1.5 text-txt-primary hover:border-accent">保存</button>
            <button onClick={() => void doTest(editing)} className="btn border border-border bg-bg-raised px-3 py-1.5 text-txt-primary hover:border-accent">测试连接</button>
            <button onClick={() => setEditing(null)} className="btn border border-border bg-bg-raised px-3 py-1.5 text-txt-secondary">取消</button>
            {msg && <span className="text-[12px] text-txt-secondary">{msg}</span>}
          </div>
        </Group>
      </>
    )
  }

  return (
    <>
      <h1 className="selectable text-[18px] font-semibold text-txt-primary">模型设置</h1>
      <Group title="已配置的模型">
        <div className="flex flex-col gap-2">
          {(config?.presets ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-md border border-border bg-bg-app px-3 py-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-white">{p.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] text-txt-primary">
                  {p.name}
                  <span className="rounded bg-bg-active px-1.5 text-[10px] text-txt-muted">{p.provider}</span>
                  <span className="text-[10px] text-txt-muted">联网自动</span>
                </div>
                <div className="truncate text-[11px] text-txt-muted">{p.model}</div>
              </div>
              {p.id === config?.activePresetId && <span className="chip border border-accent bg-accent-dim/20 text-accent">当前</span>}
              <button className="btn-icon" title="设为当前" disabled={p.id === config?.activePresetId} onClick={() => void activate(p.id)}><Icon.Check size={14} /></button>
              <button className="btn-icon" title="编辑" onClick={() => startEdit(p)}><Icon.Edit size={14} /></button>
              <button className="btn-icon" title="测试" onClick={() => void doTest(p)}><Icon.Play size={14} /></button>
              <button className="btn-icon" title="删除" onClick={() => void remove(p.id)}><Icon.Trash size={14} /></button>
            </div>
          ))}
          <button onClick={startNew} className="btn justify-center gap-1.5 border border-dashed border-border bg-bg-app px-3 py-2 text-txt-secondary hover:border-accent hover:text-txt-primary">
            <Icon.Plus size={14} /> 新增模型
          </button>
        </div>
        {msg && <div className="mt-3 text-[12px] text-txt-secondary">{msg}</div>}
      </Group>
      <Group title="说明">
        <p className="text-[12px] leading-relaxed text-txt-secondary">
          可配置多个模型端点，对话输入框下方可通过下拉快速切换，并选择「低 / 中 / 高」推理等级。联网检索无需单独开关：普通问答会自动向模型提供厂商搜索能力；项目编码任务仍优先使用项目工具。自定义端点不兼容 Responses web_search 时会自动回退普通回答。未配置时回退本地演示（Mock）。
        </p>
      </Group>
    </>
  )
}
