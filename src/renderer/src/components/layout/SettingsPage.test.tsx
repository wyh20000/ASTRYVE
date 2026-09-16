import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginMarketEntry, PluginMetadata, PluginMcpPluginView, SkillMetadata } from '@shared/types'
import type { AuditEvent } from '@shared/agent'
import {
  AuditRecordList, describePluginInstallRisk, ExtensionsSection, filterMarketplaceEntries, filterPlugins, trapPluginDialogFocus,
  listMarketplaceCategories, PluginConnectionPanel, PluginMarketDetails, PluginSection, PluginUninstallChoices, SecuritySection, SkillsSection,
  ModelSection
} from './SettingsPage'
import SettingsPage from './SettingsPage'

const skillState = vi.hoisted(() => ({
  items: [] as SkillMetadata[], catalog: [], loading: false, mutating: false, error: undefined as string | undefined,
  load: vi.fn(), loadCatalog: vi.fn(), install: vi.fn(), importLocal: vi.fn(), uninstall: vi.fn(), setEnabled: vi.fn()
}))
const pluginState = vi.hoisted(() => ({
  items: [] as PluginMetadata[], marketEntries: [] as PluginMarketEntry[], marketSources: [],
  loading: false, mutating: false, error: undefined as string | undefined,
  load: vi.fn(), importLocal: vi.fn(), setEnabled: vi.fn(), recover: vi.fn(), loadMarketplace: vi.fn(),
  addSource: vi.fn(), setSourceEnabled: vi.fn(), removeSource: vi.fn(), syncSource: vi.fn(),
  installMarket: vi.fn(), uninstall: vi.fn(), loadBackups: vi.fn(), rollback: vi.fn(),
  preferences: { autoUpdate: false }, setAutoUpdate: vi.fn(), loadPreferences: vi.fn(),
  connections: [] as PluginMcpPluginView[], mutatingConnection: false, loadConnections: vi.fn(),
  connectMcp: vi.fn(), reauthorizeMcp: vi.fn(), retryMcp: vi.fn(), disconnectMcp: vi.fn()
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

const modelState = vi.hoisted(() => ({
  config: null as unknown,
  loading: false,
  load: vi.fn(),
  save: vi.fn(),
  activate: vi.fn(),
  setReasoning: vi.fn(),
  test: vi.fn()
}))

vi.mock('../../stores/modelStore', () => ({
  useModelStore: (selector: (state: Record<string, unknown>) => unknown) => selector(modelState)
}))

vi.mock('../../stores/themeStore', () => ({
  useThemeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      presetId: 'midnight',
      mode: 'system',
      overrides: {},
      // ThemeSection 会读取 resolved 展示当前生效模式与颜色基线
      resolved: {
        light: false,
        color: {
          surface: { app: '#111315' },
          text: { primary: '#e6e8ea' },
          accent: { primary: '#4d6bfe' }
        }
      },
      setMode: vi.fn(),
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
  pluginState.preferences = { autoUpdate: false }
  pluginState.connections = []
  pluginState.mutatingConnection = false
})

describe('Settings navigation', () => {
  it('does not expose the removed managed Chrome controls', () => {
    const html = renderToStaticMarkup(<SettingsPage />)
    expect(html).not.toContain('>浏览器</span>')
    expect(html).not.toContain('独立 Chrome')
  })
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
      permissions: ['browser.read'], capabilities: ['Read'], components: ['tools'], errors: [],
      installOrigin: {
        pluginVersion: '1.2.3', sourceId: 'community-tools', sourceName: 'Community Tools',
        sourceKind: 'community', verified: false
      }
    }]
    const html = renderToStaticMarkup(<PluginSection />)
    expect(html).toContain('Acme Browser')
    expect(html).toContain('审查当前浏览器页面')
    expect(html).toContain('1.2.3')
    expect(html).toContain('浏览器读取')
    expect(html).toContain('Community Tools')
    expect(html).not.toContain('>本地<')
    expect(html).toContain('aria-label="禁用 Acme Browser"')
    expect(html).not.toContain('尚未安装插件')
    expect(filterPlugins(pluginState.items, 'browser')).toHaveLength(1)
    expect(filterPlugins(pluginState.items, 'missing')).toHaveLength(0)
  })

  it('shows the safe auto-update preference and keeps managed plugins disableable but not uninstallable', () => {
    pluginState.preferences = { autoUpdate: true }
    pluginState.items = [{
      id: 'managed.tools', name: 'Managed Tools', version: '1.0.0', description: 'Managed',
      source: 'installed', sourceFormat: 'native', enabled: true, status: 'ready', managed: true,
      permissions: [], capabilities: [], components: ['tools'], errors: []
    }]
    const html = renderToStaticMarkup(<PluginSection />)
    expect(html).toContain('自动安装安全更新')
    expect(html).toContain('checked=""')
    expect(html).toContain('受管')
    expect(html).toContain('aria-label="禁用 Managed Tools"')
    expect(html).not.toContain('title="卸载"')
  })

  it('offers explicit keep-data and clear-data uninstall choices', () => {
    const html = renderToStaticMarkup(<PluginUninstallChoices onChoose={vi.fn()} onCancel={vi.fn()} />)
    expect(html).toContain('卸载并保留数据')
    expect(html).toContain('卸载并清除数据')
    expect(html).toContain('审计记录会保留')
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

  it('renders pending, connected, failed, and restricted MCP actions without exposing credentials', () => {
    const base = {
      id: 'api', serverOrigin: 'https://api.example.com', auth: 'api-key' as const,
      compatibleConnections: []
    }
    const pending = renderToStaticMarkup(<PluginConnectionPanel pluginId="acme.remote"
      server={{ ...base, state: 'pending' }} mutating={false} onConnect={vi.fn()} onReauthorize={vi.fn()}
      onRetry={vi.fn()} onDisconnect={vi.fn()} />)
    expect(pending).toContain('type="password"')
    expect(pending).toContain('连接账号')
    expect(pending).toContain('value=""')
    expect(pending).not.toContain('secret')

    const authorizationPending = renderToStaticMarkup(<PluginConnectionPanel pluginId="acme.remote"
      server={{ ...base, state: 'pending', connectionId: '11111111-1111-4111-8111-111111111111', errorCode: 'MCP_UNAUTHORIZED' }}
      mutating={false} onConnect={vi.fn()} onReauthorize={vi.fn()} onRetry={vi.fn()} onDisconnect={vi.fn()} />)
    expect(authorizationPending).toContain('需要重新授权')
    expect(authorizationPending).toContain('新的 API Key')
    expect(authorizationPending).not.toContain('绑定已有连接')

    const connected = renderToStaticMarkup(<PluginConnectionPanel pluginId="acme.remote"
      server={{ ...base, state: 'connected', connectionId: '11111111-1111-4111-8111-111111111111', accountLabel: 'work' }}
      mutating={false} onConnect={vi.fn()} onReauthorize={vi.fn()} onRetry={vi.fn()} onDisconnect={vi.fn()} />)
    expect(connected).toContain('已连接')
    expect(connected).toContain('重新授权')
    expect(connected).toContain('断开')
    expect(connected).toContain('work')

    const failed = renderToStaticMarkup(<PluginConnectionPanel pluginId="acme.remote"
      server={{ ...base, state: 'failed', connectionId: '11111111-1111-4111-8111-111111111111', errorCode: 'MCP_CONNECT_FAILED' }}
      mutating={false} onConnect={vi.fn()} onReauthorize={vi.fn()} onRetry={vi.fn()} onDisconnect={vi.fn()} />)
    expect(failed).toContain('连接失败')
    expect(failed).toContain('重试')
    expect(failed).toContain('断开')

    const restricted = renderToStaticMarkup(<PluginConnectionPanel pluginId="acme.remote"
      server={{ ...base, state: 'restricted', connectionId: '11111111-1111-4111-8111-111111111111' }} mutating={false} onConnect={vi.fn()} onReauthorize={vi.fn()}
      onRetry={vi.fn()} onDisconnect={vi.fn()} />)
    expect(restricted).toContain('启用插件并授予联网权限后才能连接')
    expect(restricted).not.toContain('连接账号')
    expect(restricted).toContain('断开')
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
      installOrigin: { pluginVersion: '1.0.0', sourceId: 'legacy-source', sourceName: 'Legacy', sourceKind: 'community', verified: false, publisherId: 'key-v1' }
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
      installOrigin: { pluginVersion: '1.0.0', sourceId: marketEntry.sourceId, sourceName: marketEntry.sourceName, sourceKind: 'official', verified: true, publisherId: 'key-v1' }
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

  it('describes browser permissions without implying a managed Chrome instance', () => {
    const html = renderToStaticMarkup(<PluginMarketDetails entry={{ ...marketEntry, dataTargets: [] }}
      releases={[{ ...marketEntry, dataTargets: [] }]} onClose={vi.fn()} onConfirm={vi.fn()} mutating={false} />)
    expect(html).toContain('已连接浏览器页面')
    expect(html).not.toContain('独立浏览器页面')
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

describe('Appearance settings section', () => {
  it('exposes the three theme modes through an accessible segmented control', () => {
    const html = renderToStaticMarkup(<SettingsPage />)
    expect(html).toContain('跟随系统')
    expect(html).toContain('浅色')
    expect(html).toContain('深色')
    expect(html).toContain('aria-label="主题模式"')
  })

  it('renders the theme mode cards without an outer framed container', () => {
    const html = renderToStaticMarkup(<SettingsPage />)
    expect(html).toContain('主题模式：跟随系统')
    expect(html).toContain('主题模式：浅色')
    expect(html).toContain('主题模式：深色')
    // 不再展示「当前实际生效」文案（用户要求）
    expect(html).not.toMatch(/当前：(深色|浅色)/)
  })

  it('renders the three theme mode cards as a radiogroup', () => {
    const html = renderToStaticMarkup(<SettingsPage />)
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('role="radio"')
    expect(html).toContain('主题模式：浅色')
    expect(html).toContain('主题模式：深色')
  })

  it('keeps background, text and accent colour inputs', () => {
    const html = renderToStaticMarkup(<SettingsPage />)
    expect(html).toContain('背景色')
    expect(html).toContain('文字颜色')
    expect(html).toContain('强调色')
  })

  it('disables the reset action until a colour is customised', () => {
    const html = renderToStaticMarkup(<SettingsPage />)
    // 没有覆盖时「恢复默认」应为禁用态
    // 精确断言 antd Button 的禁用标记，避免匹配到页面上其他 disabled 属性
    const resetButton = html.match(/<button[^>]*disabled=""[^>]*><span>恢复默认<\/span><\/button>/)
    expect(resetButton, '「恢复默认」在无自定义颜色时应为禁用态').not.toBeNull()
  })

  it('no longer renders the old preset theme cards', () => {
    const html = renderToStaticMarkup(<SettingsPage />)
    expect(html).not.toContain('午夜蓝')
    expect(html).not.toContain('日光（浅色）')
  })
})

describe('Security settings page', () => {
  it('offers a concise user-controlled audit cleanup action', () => {
    const html = renderToStaticMarkup(<SecuritySection />)
    expect(html).toContain('安全与数据')
    expect(html).toContain('清除审计记录')
    expect(html).not.toContain('agent-audit.json')
  })

  it('shows recent audit evidence and highlights permission, update, startup and isolation issues', () => {
    const base: AuditEvent = {
      id: 'audit-1', timestamp: 1, taskId: 'task-1', workspaceId: 'workspace-1',
      actor: 'policy', action: 'approval', outcome: 'deny'
    }
    const html = renderToStaticMarkup(<AuditRecordList events={[
      { ...base, reasonCode: 'USER_DENIED', toolName: 'plugin.acme.deploy', pluginId: 'acme', pluginVersion: '1.0.0' },
      { ...base, id: 'audit-2', action: 'plugin.update', outcome: 'failure', reasonCode: 'PLUGIN_UPDATE_FAILED' },
      { ...base, id: 'audit-3', action: 'plugin.start', outcome: 'failure', reasonCode: 'PLUGIN_START_FAILED' },
      { ...base, id: 'audit-4', action: 'plugin.isolation', outcome: 'failure', reasonCode: 'PLUGIN_ISOLATED' },
      { ...base, id: 'audit-5', action: 'plugin.connection.connect', outcome: 'success', pluginId: 'remote' }
    ]} />)
    expect(html).toContain('权限')
    expect(html).toContain('更新')
    expect(html).toContain('启动')
    expect(html).toContain('隔离')
    expect(html).toContain('连接')
    expect(html).toContain('acme@1.0.0')
    expect(html).not.toContain('workspace-1')
  })
})

describe('Model settings section', () => {
  beforeEach(() => {
    modelState.config = null
  })

  it('uses the shared section heading level (20px page title)', () => {
    const html = renderToStaticMarkup(<ModelSection />)
    expect(html).toContain('text-[20px]')
    expect(html).toContain('模型设置')
  })

  it('explains model switching and lists the configured section', () => {
    const html = renderToStaticMarkup(<ModelSection />)
    expect(html).toContain('已配置的模型')
    expect(html).toContain('对话输入框下方可快速切换当前模型')
  })

  it('renders configured presets with provider metadata and per-row actions', () => {
    modelState.config = {
      activePresetId: 'p1',
      reasoning: 'medium',
      presets: [
        {
          id: 'p1',
          name: 'DeepSeek',
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          hasApiKey: true
        },
        {
          id: 'p2',
          name: 'Kimi',
          provider: 'kimi',
          baseUrl: 'https://api.moonshot.cn/v1',
          model: 'moonshot-v1-8k',
          hasApiKey: true
        }
      ]
    }
    const html = renderToStaticMarkup(<ModelSection />)

    expect(html).toContain('DeepSeek')
    expect(html).toContain('Kimi')
    expect(html).toContain('deepseek-chat')
    expect(html).toContain('moonshot-v1-8k')
    // 提供方改用语义标签而不是裸 span
    expect(html).toContain('ant-tag')
    // 每行提供无文字图标操作，必须有可访问名称
    expect(html).toContain('aria-label="编辑"')
    expect(html).toContain('aria-label="测试"')
    expect(html).toContain('aria-label="删除"')
  })

  it('marks the active preset action as unavailable', () => {
    modelState.config = {
      activePresetId: 'p1',
      presets: [
        { id: 'p1', name: 'A', provider: 'custom', baseUrl: 'u', model: 'm', hasApiKey: false }
      ]
    }
    const html = renderToStaticMarkup(<ModelSection />)
    // 注意属性顺序：IconButton 先输出 aria-label，再输出 disabled
    const disabled = html.match(/<button[^>]*aria-label="设为当前"[^>]*disabled=""/)
    expect(disabled, '当前预设的「设为当前」应为禁用态').not.toBeNull()
  })

  it('offers an add-model action', () => {
    modelState.config = { activePresetId: null, presets: [] }
    const html = renderToStaticMarkup(<ModelSection />)
    expect(html).toContain('新增模型')
  })
})
