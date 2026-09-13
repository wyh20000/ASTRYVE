import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginMarketEntry, PluginMetadata, SkillMetadata } from '@shared/types'
import {
  describePluginInstallRisk, ExtensionsSection, filterMarketplaceEntries, filterPlugins, trapPluginDialogFocus,
  listMarketplaceCategories, PluginMarketDetails, PluginSection, SecuritySection, SkillsSection
} from './SettingsPage'

const skillState = vi.hoisted(() => ({
  items: [] as SkillMetadata[], catalog: [], loading: false, mutating: false, error: undefined as string | undefined,
  load: vi.fn(), loadCatalog: vi.fn(), install: vi.fn(), importLocal: vi.fn(), uninstall: vi.fn(), setEnabled: vi.fn()
}))
const pluginState = vi.hoisted(() => ({
  items: [] as PluginMetadata[], marketEntries: [] as PluginMarketEntry[], marketSources: [],
  loading: false, mutating: false, error: undefined as string | undefined,
  load: vi.fn(), importLocal: vi.fn(), setEnabled: vi.fn(), recover: vi.fn(), loadMarketplace: vi.fn(),
  addSource: vi.fn(), setSourceEnabled: vi.fn(), removeSource: vi.fn(), syncSource: vi.fn(),
  installMarket: vi.fn(), uninstall: vi.fn(), loadBackups: vi.fn(), rollback: vi.fn()
}))

const marketEntry: PluginMarketEntry = {
  id: 'acme.browser', name: 'Acme Browser', version: '2.0.0', description: '审查当前浏览器页面',
  author: 'Acme', sourceId: 'official', sourceName: 'Codex official', sourceKind: 'official', verified: true,
  permissions: ['browser.read', 'browser.interact'], categories: ['浏览器'], changelog: '新增安全点击',
  minAppVersion: '0.1.0', platforms: ['win32'], architectures: ['x64'], recommended: true,
  capabilities: ['Inspect', 'Click'], components: ['tools'], dataTargets: ['当前标签页'], installable: true,
  signingKeyId: 'acme-key-v2'
}

vi.mock('../../stores/skillStore', () => ({
  useSkillStore: (selector: (state: typeof skillState) => unknown) => selector(skillState)
}))
vi.mock('../../stores/pluginStore', () => ({
  usePluginStore: (selector: (state: typeof pluginState) => unknown) => selector(pluginState)
}))

vi.mock('../../stores/themeStore', () => ({
  useThemeStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    presetId: 'midnight',
    overrides: {},
    setPreset: vi.fn(),
    setBg: vi.fn(),
    setText: vi.fn(),
    setAccent: vi.fn(),
    resetOverrides: vi.fn()
  })
}))

beforeEach(() => {
  skillState.items = []
  skillState.loading = false
  skillState.error = undefined
  pluginState.items = []
  pluginState.marketEntries = []
  pluginState.loading = false
  pluginState.mutating = false
  pluginState.error = undefined
})

describe('Skills settings page', () => {
  it('keeps the installed list compact and moves technical metadata behind expansion', () => {
    skillState.items = [{
      id: `project:${'a'.repeat(12)}:review`, name: 'review', displayName: 'Review', description: '审查项目代码', source: 'project',
      enabled: true, active: true, autoTrigger: true, requestedTools: ['workspace.readFile'],
      allowedTools: ['workspace.readFile'], resources: ['references/checklist.md'], invocation: 'model',
      toolPolicy: 'declared', installKind: 'external', errors: [], shadowedBy: undefined
    }, {
      id: `codex:${'b'.repeat(12)}:broken`, name: 'broken', displayName: 'Broken', description: '无法加载', source: 'codex',
      enabled: true, active: false, autoTrigger: false, requestedTools: [], allowedTools: [], resources: [],
      invocation: 'user', toolPolicy: 'inherit', installKind: 'external', errors: ['Skill frontmatter 未闭合'],
      shadowedBy: `project:${'a'.repeat(12)}:review`
    }]
    const html = renderToStaticMarkup(<SkillsSection />)
    expect(html).toContain('审查项目代码')
    expect(html).toContain('aria-label="禁用 Review"')
    expect(html).toContain('aria-label="禁用 Broken"')
    expect(html).not.toContain('声明 1 个工具，仍受权限审批')
    expect(html).not.toContain('references/checklist.md')
    expect(html).not.toContain('已被高优先级同名项覆盖')
    expect(html).not.toContain('Skill frontmatter 未闭合')
  })
})

describe('Extensions settings page', () => {
  it('combines plugins and skills under one accessible top-level tab bar', () => {
    const html = renderToStaticMarkup(<ExtensionsSection initialTab="plugins" />)
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('插件</button>')
    expect(html).toContain('技能</button>')
    expect(html).toContain('在你常用的工具中与 AI Agent 协作')
    expect(html).not.toContain('技能市场')
  })

  it('keeps the existing real skill manager available from the skills tab', () => {
    const html = renderToStaticMarkup(<ExtensionsSection initialTab="skills" />)
    expect(html).toContain('通过任务专用技能扩展 AI 的能力')
    expect(html).toContain('技能市场')
    expect(html).not.toContain('插件功能将在下一阶段接入')
  })

  it('uses an honest plugin empty state without fake marketplace entries', () => {
    const html = renderToStaticMarkup(<PluginSection />)
    expect(html).toContain('尚未安装插件')
    expect(html).toContain('导入后默认禁用')
    expect(html).toContain('导入文件夹')
    expect(html).toContain('导入 ZIP')
    expect(html).not.toContain('aria-disabled="true"')
    expect(html).not.toContain('Gmail')
    expect(html).not.toContain('GitHub')
  })

  it('renders the real installed plugin list and concise capability metadata', () => {
    pluginState.items = [{
      id: 'acme.browser', name: 'Acme Browser', version: '1.2.3', description: '审查当前浏览器页面',
      author: 'Acme', source: 'installed', sourceFormat: 'native', enabled: true, status: 'ready',
      permissions: ['browser.read'], capabilities: ['Read'], components: ['tools'], errors: []
    }]
    const html = renderToStaticMarkup(<PluginSection />)
    expect(html).toContain('Acme Browser')
    expect(html).toContain('审查当前浏览器页面')
    expect(html).toContain('1.2.3')
    expect(html).toContain('浏览器读取')
    expect(html).toContain('aria-label="禁用 Acme Browser"')
    expect(html).not.toContain('尚未安装插件')
    expect(filterPlugins(pluginState.items, 'browser')).toHaveLength(1)
    expect(filterPlugins(pluginState.items, 'missing')).toHaveLength(0)
  })

  it('shows invalid manifests as disabled diagnostic rows', () => {
    pluginState.items = [{
      id: 'broken-plugin', name: 'broken', description: '', source: 'installed', sourceFormat: 'native',
      enabled: false, status: 'invalid', permissions: [], capabilities: [], components: [], errors: ['插件清单不是有效 JSON']
    }]
    const html = renderToStaticMarkup(<PluginSection />)
    expect(html).toContain('清单无效')
    expect(html).toContain('插件清单不是有效 JSON')
    expect(html).toContain('disabled=""')
  })

  it('filters the market by discovery scope, category and searchable capability metadata', () => {
    const community = {
      ...marketEntry, id: 'community.writer', name: 'Writer', sourceId: 'community', sourceName: 'Community Hub',
      sourceKind: 'community' as const, verified: false, recommended: false, categories: ['写作'], capabilities: ['Draft']
    }
    expect(filterMarketplaceEntries([marketEntry, community], { scope: 'recommended', category: 'all', query: '' }))
      .toEqual([marketEntry])
    expect(filterMarketplaceEntries([marketEntry, community], { scope: 'community', category: '写作', query: 'draft' }))
      .toEqual([community])
    expect(listMarketplaceCategories([community, marketEntry])).toEqual(['浏览器', '写作'])
  })

  it('flags permission and publisher changes before an update', () => {
    const installed: PluginMetadata = {
      id: marketEntry.id, name: marketEntry.name, version: '1.0.0', description: marketEntry.description,
      source: 'installed', sourceFormat: 'native', enabled: false, status: 'ready',
      permissions: ['browser.read'], capabilities: ['Inspect'], components: ['tools'], errors: [],
      marketOrigin: { pluginVersion: '1.0.0', sourceId: 'legacy-source', sourceName: 'Legacy', sourceKind: 'community', verified: false, publisherId: 'key-v1' }
    }
    const rewrittenRelease: PluginMarketEntry = { ...marketEntry, version: '1.0.0', permissions: ['browser.read'] }
    const risk = describePluginInstallRisk(marketEntry, installed, [rewrittenRelease, marketEntry])
    expect(risk).toMatchObject({
      mode: 'update', addedPermissions: ['browser.interact'], sourceChanged: true,
      signingChanged: true, requiresFreshApproval: true
    })
    expect(describePluginInstallRisk({ ...marketEntry, version: '0.9.0' }, installed, [marketEntry]).mode).toBe('older')
  })

  it('renders a complete keyboard-accessible plugin detail and update summary', () => {
    const installed: PluginMetadata = {
      id: marketEntry.id, name: marketEntry.name, version: '1.0.0', description: marketEntry.description,
      source: 'installed', sourceFormat: 'native', enabled: false, status: 'ready',
      permissions: ['browser.read'], capabilities: ['Inspect'], components: ['tools'], errors: [],
      marketOrigin: { pluginVersion: '1.0.0', sourceId: marketEntry.sourceId, sourceName: marketEntry.sourceName, sourceKind: 'official', verified: true, publisherId: 'key-v1' }
    }
    const html = renderToStaticMarkup(<PluginMarketDetails entry={marketEntry} installed={installed}
      releases={[{ ...marketEntry, version: '1.0.0', permissions: ['browser.read'], signingKeyId: 'acme-key-v1' }, marketEntry]}
      onClose={vi.fn()} onConfirm={vi.fn()} mutating={false} />)
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('autofocus=""')
    expect(html).toContain('新增安全点击')
    expect(html).toContain('当前标签页')
    expect(html).toContain('浏览器交互')
    expect(html).toContain('发布者签名已变化')
    expect(html).toContain('更新并重新确认')
  })

  it('contains tab focus inside the plugin detail drawer', () => {
    const first = { focus: vi.fn() }
    const last = { focus: vi.fn() }
    const root = { querySelectorAll: vi.fn().mockReturnValue([first, last]) }
    const event = { key: 'Tab', shiftKey: false, preventDefault: vi.fn(), target: last }
    trapPluginDialogFocus(event, root)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(first.focus).toHaveBeenCalledOnce()
  })
})

describe('Security settings page', () => {
  it('offers a concise user-controlled audit cleanup action', () => {
    const html = renderToStaticMarkup(<SecuritySection />)
    expect(html).toContain('安全与数据')
    expect(html).toContain('清除审计记录')
    expect(html).not.toContain('agent-audit.json')
  })
})
