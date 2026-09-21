/**
 * @vitest-environment jsdom
 *
 * 阶段 D：设置页交互回归。
 *
 * 背景（文档 11 第 10 节「不破坏逻辑的迁移约束」）：
 * 设置页里的原生 `<input>` / `<select>` / `<button className="btn|btn-icon">`
 * 本轮迁移到全局组件层。外观统一之外，**行为必须逐条证明没变**：
 * 可访问名称、禁用条件、条件渲染分支，以及最终提交给 store / IPC 的载荷。
 *
 * 因此这里不测样式类名，只测「用户能做到什么、系统收到什么」。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginMarketEntry, PluginMetadata, PluginMcpConnectInput, PluginMcpPluginView, PluginMcpServerView, SkillCatalogItem, SkillMetadata } from '@shared/types'
import { BrowserSection, PluginConnectionPanel, PluginMarketDetails, PluginSection, PluginUninstallChoices, SkillsSection } from './SettingsPage'

const skillState = vi.hoisted(() => ({
  items: [] as SkillMetadata[], catalog: [] as SkillCatalogItem[], loading: false, mutating: false, error: undefined as string | undefined,
  load: vi.fn(),
  loadCatalog: vi.fn(),
  // 与 store 契约一致：这两个动作返回 Promise<boolean>
  install: vi.fn(async () => true),
  importLocal: vi.fn(),
  uninstall: vi.fn(async () => true),
  setEnabled: vi.fn(async () => undefined)
}))

vi.mock('../../stores/skillStore', () => ({
  useSkillStore: (selector: (state: typeof skillState) => unknown) => selector(skillState)
}))

const pluginState = vi.hoisted(() => ({
  items: [] as PluginMetadata[], marketEntries: [] as PluginMarketEntry[], marketSources: [],
  skillsByPlugin: {} as Record<string, SkillMetadata[]>, loadPluginSkills: vi.fn(async () => undefined),
  loading: false, mutating: false, error: undefined as string | undefined,
  load: vi.fn(), importLocal: vi.fn(), setEnabled: vi.fn(async () => undefined), recover: vi.fn(), loadMarketplace: vi.fn(),
  addSource: vi.fn(), setSourceEnabled: vi.fn(), removeSource: vi.fn(), syncSource: vi.fn(),
  installMarket: vi.fn(async () => true), uninstall: vi.fn(async () => undefined), loadBackups: vi.fn(async () => []), rollback: vi.fn(),
  preferences: { autoUpdate: false }, setAutoUpdate: vi.fn(), loadPreferences: vi.fn(),
  connections: [] as PluginMcpPluginView[], mutatingConnection: false, loadConnections: vi.fn(),
  connectMcp: vi.fn(), reauthorizeMcp: vi.fn(), retryMcp: vi.fn(), disconnectMcp: vi.fn()
}))

vi.mock('../../stores/pluginStore', () => ({
  usePluginStore: (selector: (state: typeof pluginState) => unknown) => selector(pluginState)
}))

const sessionState = vi.hoisted(() => ({
  activeId: 'blank', sessions: [{ id: 'blank', title: '', projectPath: null, pinned: false, createdAt: 1, updatedAt: 1 }],
  create: vi.fn(async () => ({ id: 'blank', title: '', projectPath: null, pinned: false, createdAt: 1, updatedAt: 1 }))
}))
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (selector: (state: typeof sessionState) => unknown) => selector(sessionState)
}))

const uiState = vi.hoisted(() => ({ closeSettings: vi.fn(), setPendingPrompt: vi.fn() }))
vi.mock('../../stores/uiStore', () => ({
  useUiStore: (selector: (state: typeof uiState) => unknown) => selector(uiState)
}))

vi.mock('../../stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (state: { recent: never[] }) => unknown) => selector({ recent: [] })
}))

const marketEntry: PluginMarketEntry = {
  id: 'acme.browser', name: 'Acme Browser', version: '2.0.0', description: '审查当前浏览器页面',
  author: 'Acme', sourceId: 'official', sourceName: 'Codex official', sourceKind: 'official', verified: true,
  permissions: ['browser.read'], categories: ['浏览器'], changelog: '新增安全点击',
  minAppVersion: '0.1.0', platforms: ['win32'], architectures: ['x64'],
  capabilities: ['Inspect'], components: ['tools'], dataTargets: ['当前标签页'], installable: true
}

function skill(overrides: Partial<SkillMetadata>): SkillMetadata {
  return {
    id: 'skill-1', name: 'review', displayName: 'Review', description: '审查项目代码', source: 'project',
    enabled: true, active: true, autoTrigger: true, requestedTools: [], allowedTools: [], resources: [],
    invocation: 'model', toolPolicy: 'declared', installKind: 'external', errors: [],
    ...overrides
  }
}

const mcpServer: PluginMcpServerView = {
  id: 'api-server', serverOrigin: 'https://api.example.com', auth: 'api-key', state: 'pending',
  compatibleConnections: [
    { id: 'conn-1', serverOrigin: 'https://api.example.com', auth: 'api-key', state: 'connected', accountLabel: 'work' }
  ]
}

function catalogItem(overrides: Partial<SkillCatalogItem>): SkillCatalogItem {
  return {
    id: 'market:pdf', name: 'pdf', displayName: 'PDF 处理', description: '解析 PDF',
    repository: 'https://github.com/acme/pdf', installUrl: 'https://example.com/pdf.tar.gz',
    publisher: 'Acme', featured: false, installed: false,
    ...overrides
  }
}

beforeEach(() => {
  // 行内操作按钮迁移后要断言「确实调到了哪个 store 方法」，先清掉历史调用
  vi.clearAllMocks()
  skillState.items = []
  skillState.catalog = []
  skillState.loading = false
  skillState.mutating = false
  skillState.error = undefined
  pluginState.items = []
  pluginState.marketEntries = []
  pluginState.skillsByPlugin = {}
  pluginState.loading = false
  pluginState.mutating = false
  pluginState.error = undefined
})

describe('Browser settings', () => {
  it('loads and saves the official MCP website allowlist through the trusted bridge', async () => {
    const getBrowserPreferences = vi.fn(async () => ({
      ok: true as const,
      data: { allowAllSites: false, allowedOrigins: [], blockedOrigins: [] }
    }))
    const setBrowserPreferences = vi.fn(async (value) => ({ ok: true as const, data: value }))
    const testBrowserConnection = vi.fn(async () => ({
      ok: true as const, data: { tabCount: 2 }
    }))
    const disconnectBrowser = vi.fn(async () => ({
      ok: true as const, data: { disconnected: true as const }
    }))
    const previous = Object.getOwnPropertyDescriptor(window.agent, 'settings')
    Object.defineProperty(window.agent, 'settings', {
      configurable: true,
      value: {
        getBrowserPreferences,
        setBrowserPreferences,
        testBrowserConnection,
        disconnectBrowser
      }
    })
    try {
      const user = userEvent.setup()
      render(<BrowserSection />)
      const allowAll = await screen.findByRole('switch', { name: '允许所有网站' })
      await user.click(allowAll)
      await user.type(screen.getByRole('textbox', { name: '允许的网站来源' }),
        'https://example.com{enter}https://app.example.com')
      await user.click(screen.getByRole('button', { name: '保存网站权限' }))

      await waitFor(() => expect(setBrowserPreferences).toHaveBeenCalledWith({
        allowAllSites: true,
        allowedOrigins: ['https://example.com', 'https://app.example.com'],
        blockedOrigins: []
      }))
      expect(screen.getByRole('status')).toHaveTextContent('浏览器网站权限已保存')

      await user.click(screen.getByRole('button', { name: '测试官方连接' }))
      await waitFor(() => expect(testBrowserConnection).toHaveBeenCalledTimes(1))
      expect(screen.getByRole('status')).toHaveTextContent('发现 2 个标签页')

      await user.click(screen.getByRole('button', { name: '断开连接' }))
      await waitFor(() => expect(disconnectBrowser).toHaveBeenCalledTimes(1))
      expect(screen.getByRole('status')).toHaveTextContent('已断开 Google 官方 MCP')
    } finally {
      if (previous) Object.defineProperty(window.agent, 'settings', previous)
      else Reflect.deleteProperty(window.agent, 'settings')
    }
  })
})

function installedPlugin(overrides: Partial<PluginMetadata> = {}): PluginMetadata {
  return {
    id: 'acme.browser', name: 'Acme Browser', version: '2.0.0', description: '审查当前浏览器页面',
    author: 'Acme', source: 'installed', sourceFormat: 'native', enabled: true, status: 'ready',
    permissions: ['browser.read'], capabilities: ['Inspect'], components: ['skills', 'tools'], errors: [],
    ...overrides
  }
}

describe('插件市场与同页详情', () => {
  it('only opens the declared isolated UI for an enabled installed plugin', async () => {
    const openUi = vi.fn(async () => ({ ok: true, data: undefined }))
    const previous = Object.getOwnPropertyDescriptor(window.agent, 'plugins')
    Object.defineProperty(window.agent, 'plugins', { configurable: true, value: { openUi } })
    try {
      pluginState.items = [installedPlugin({ components: ['ui'] })]
      render(<PluginSection />)
      await userEvent.click(screen.getByRole('button', { name: '打开 Acme Browser' }))
      await userEvent.click(screen.getByRole('button', { name: '打开插件界面' }))
      await waitFor(() => expect(openUi).toHaveBeenCalledWith({ id: 'acme.browser' }))
    } finally {
      if (previous) Object.defineProperty(window.agent, 'plugins', previous)
      else Reflect.deleteProperty(window.agent, 'plugins')
    }
  })

  it('已下载插件只显示图标，点击后进入详情并可返回', async () => {
    pluginState.items = [installedPlugin()]
    pluginState.marketEntries = [{ ...marketEntry, categories: ['Productivity'] }]
    skillState.items = [skill({ id: 'plugin:review', source: 'plugin', pluginId: 'acme.browser', displayName: 'Browser Review' })]
    render(<PluginSection />)

    expect(screen.getByRole('button', { name: '打开 Acme Browser' })).toBeInTheDocument()
    const installed = screen.getByRole('heading', { name: '已安装' }).closest('section') as HTMLElement
    expect(within(installed).queryByText('审查当前浏览器页面')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '打开 Acme Browser' }))
    expect(screen.getByRole('heading', { name: 'Acme Browser' })).toBeInTheDocument()
    expect(screen.getByText('审查当前浏览器页面')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '禁用 Browser Review' })).toBeChecked()
    expect(screen.getByRole('button', { name: '历史版本' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '插件' }))
    expect(screen.getByRole('button', { name: '打开 Acme Browser' })).toBeInTheDocument()
  })

  it('插件技能开关复用既有技能启停动作', async () => {
    pluginState.items = [installedPlugin()]
    pluginState.marketEntries = [marketEntry]
    skillState.items = [skill({ id: 'plugin:review', source: 'plugin', pluginId: 'acme.browser', displayName: 'Browser Review' })]
    render(<PluginSection />)

    await userEvent.click(screen.getByRole('button', { name: '打开 Acme Browser' }))
    await userEvent.click(screen.getByRole('switch', { name: '禁用 Browser Review' }))
    expect(skillState.setEnabled).toHaveBeenCalledWith('plugin:review', false)
  })

  it('已禁用技能仍可重新打开，不会被 inactive 状态锁死', async () => {
    pluginState.items = [installedPlugin()]
    pluginState.marketEntries = [marketEntry]
    skillState.items = [skill({
      id: 'plugin:review', source: 'plugin', pluginId: 'acme.browser', displayName: 'Browser Review',
      enabled: false, active: false
    })]
    render(<PluginSection />)

    await userEvent.click(screen.getByRole('button', { name: '打开 Acme Browser' }))
    const toggle = screen.getByRole('switch', { name: '启用 Browser Review' })
    expect(toggle).toBeEnabled()
    await userEvent.click(toggle)
    expect(skillState.setEnabled).toHaveBeenCalledWith('plugin:review', true)
  })

  it('未安装插件点击安装后直接调用市场安装', async () => {
    pluginState.marketEntries = [{ ...marketEntry, recommended: false, categories: ['Productivity'] }]
    let finish: ((value: boolean) => void) | undefined
    pluginState.installMarket.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve }))
    render(<PluginSection />)

    await userEvent.click(screen.getByRole('button', { name: '安装' }))
    expect(pluginState.installMarket).toHaveBeenCalledWith('official', 'acme.browser', '2.0.0')
    expect(screen.getByRole('button', { name: '安装中…' })).toBeDisabled()
    finish?.(true)
    await waitFor(() => expect(screen.getByRole('button', { name: '安装' })).toBeInTheDocument())
  })

  it('每个市场条目独立显示安装状态，不锁住其他安装按钮', async () => {
    pluginState.marketEntries = [
      { ...marketEntry, id: 'acme.browser', name: 'Acme Browser', recommended: false, categories: ['Productivity'] },
      { ...marketEntry, id: 'acme.docs', name: 'Acme Docs', recommended: false, categories: ['Productivity'] }
    ]
    const finishes: Array<(value: boolean) => void> = []
    pluginState.installMarket.mockImplementation(() => new Promise<boolean>((resolve) => finishes.push(resolve)))
    render(<PluginSection />)

    const installButtons = screen.getAllByRole('button', { name: '安装' })
    await userEvent.click(installButtons[0])
    expect(screen.getByRole('button', { name: '安装中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '安装' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: '安装' }))
    expect(screen.getAllByRole('button', { name: '安装中…' })).toHaveLength(2)
    finishes.forEach((finish) => finish(true))
    await waitFor(() => expect(screen.getAllByRole('button', { name: '安装' })).toHaveLength(2))
  })

  it('禁用插件仍展示真实技能清单，但不允许直接切换技能', async () => {
    pluginState.items = [installedPlugin({ enabled: false })]
    pluginState.marketEntries = [{ ...marketEntry, components: ['skills'], categories: ['Productivity'] }]
    pluginState.skillsByPlugin = {
      'acme.browser': [skill({ id: 'plugin:review', source: 'plugin', pluginId: 'acme.browser', displayName: 'Browser Review' })]
    }
    render(<PluginSection />)

    await userEvent.click(screen.getByRole('button', { name: '打开 Acme Browser' }))
    expect(screen.getByText('插件已禁用；启用插件后可调整技能开关。')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '禁用 Browser Review' })).toBeDisabled()
    expect(pluginState.loadPluginSkills).toHaveBeenCalledWith('acme.browser')
  })

  it('没有技能组件的应用插件不展示误导性的技能 0 区块', async () => {
    pluginState.marketEntries = [{ ...marketEntry, components: ['tools'], recommended: false, categories: ['Productivity'] }]
    render(<PluginSection />)
    expect(screen.queryByRole('group', { name: '市场范围' })).not.toBeInTheDocument()
    const row = screen.getByText('Acme Browser').closest('article')
    expect(row).toHaveClass('rounded-lg')
    expect(row).not.toHaveClass('border-b')
    await userEvent.click(screen.getByRole('button', { name: '查看 Acme Browser 详情' }))
    expect(screen.queryByRole('heading', { name: '技能' })).not.toBeInTheDocument()
  })

  it('已安装市场项的三点菜单提供立即试用、管理和卸载', async () => {
    pluginState.items = [installedPlugin()]
    pluginState.marketEntries = [{ ...marketEntry, recommended: false, categories: ['Productivity'] }]
    render(<PluginSection />)

    await userEvent.click(screen.getByLabelText('更多 Acme Browser'))
    expect(screen.getByRole('menuitem', { name: '管理' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '卸载' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: '立即试用' }))

    expect(uiState.setPendingPrompt).toHaveBeenCalledWith('@acme.browser ', 'blank')
    expect(uiState.closeSettings).toHaveBeenCalled()
    expect(sessionState.create).toHaveBeenCalled()
    expect(sessionState.create.mock.invocationCallOrder[0]).toBeLessThan(uiState.setPendingPrompt.mock.invocationCallOrder[0])
  })
})

describe('MCP 连接面板 - 迁移到全局组件后行为不变', () => {
  function renderPanel(
    server: PluginMcpServerView,
    onConnect = vi.fn(async (_input: PluginMcpConnectInput) => true)
  ): { onConnect: typeof onConnect } {
    render(
      <PluginConnectionPanel
        pluginId="acme.remote"
        server={server}
        mutating={false}
        onConnect={onConnect}
        onReauthorize={vi.fn(async () => true)}
        onRetry={vi.fn()}
        onDisconnect={vi.fn()}
      />
    )
    return { onConnect }
  }

  it('选择「已有连接」后隐藏凭据输入，并按 connectionId 提交', async () => {
    const { onConnect } = renderPanel(mcpServer)
    // 凭据输入在未绑定连接时可见
    expect(screen.getByLabelText('API Key')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('绑定已有连接'))
    await userEvent.click(await screen.findByText('work'))

    // 绑定已有连接后不再要求输入密钥，按钮语义切换为「绑定连接」
    await waitFor(() => expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '绑定连接' }))

    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1))
    expect(onConnect.mock.calls[0][0]).toMatchObject({
      pluginId: 'acme.remote',
      serverId: 'api-server',
      connectionId: 'conn-1'
    })
  })

  it('api-key 连接在未填写密钥时禁止提交，填写后把密钥交给 store', async () => {
    const { onConnect } = renderPanel({ ...mcpServer, compatibleConnections: [] })

    const submit = screen.getByRole('button', { name: '连接账号' })
    expect(submit).toBeDisabled()

    await userEvent.type(screen.getByLabelText('API Key'), 'sk-local-secret')
    expect(submit).toBeEnabled()
    await userEvent.type(screen.getByLabelText('账号标签（可选）'), 'work')
    await userEvent.click(submit)

    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1))
    expect(onConnect.mock.calls[0][0]).toMatchObject({ credential: 'sk-local-secret', accountLabel: 'work' })
  })

  it('限制态不提供任何凭据入口', () => {
    renderPanel({ ...mcpServer, state: 'restricted' })
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '连接账号' })).not.toBeInTheDocument()
  })

  it('断开连接仍是二次确认，并使用 danger 语义而不是只把文字染红', async () => {
    const onDisconnect = vi.fn()
    render(
      <PluginConnectionPanel
        pluginId="acme.remote"
        server={{ ...mcpServer, state: 'connected', connectionId: 'conn-1', accountLabel: 'work' }}
        mutating={false}
        onConnect={vi.fn()}
        onReauthorize={vi.fn()}
        onRetry={vi.fn()}
        onDisconnect={onDisconnect}
      />
    )

    const disconnect = screen.getByRole('button', { name: '断开' })
    // antd 6 的危险态类名：antd/es/button/button.js:227 `-dangerous`
    expect(disconnect.className).toContain('ant-btn-dangerous')

    await userEvent.click(disconnect)
    // 第一次点击只是进入确认态，不会真的断开
    expect(onDisconnect).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '确认断开' }))
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledWith({ connectionId: 'conn-1' }))
  })
})

describe('技能页 - 迁移到全局组件后行为不变', () => {
  it('来源筛选仍是可访问的下拉，并能按来源过滤列表', async () => {
    skillState.items = [
      skill({ id: 'project:review', source: 'project', displayName: 'Review' }),
      skill({ id: 'codex:broken', source: 'codex', displayName: 'Broken', active: false, invocation: 'user' })
    ]
    render(<SkillsSection />)

    // 开关已移入详情弹窗：列表用行本身作为存在性探针
    expect(screen.getByLabelText('查看技能 Review 详情')).toBeInTheDocument()
    expect(screen.getByLabelText('查看技能 Broken 详情')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('筛选 Skill 来源'))
    await userEvent.click(await screen.findByText('项目'))

    expect(screen.getByLabelText('查看技能 Review 详情')).toBeInTheDocument()
    expect(screen.queryByLabelText('查看技能 Broken 详情')).not.toBeInTheDocument()
  })

  it('搜索框仍按名称过滤列表', async () => {
    skillState.items = [
      skill({ id: 'project:review', displayName: 'Review' }),
      skill({ id: 'codex:broken', displayName: 'Broken', source: 'codex', description: '无法加载' })
    ]
    render(<SkillsSection />)

    await userEvent.type(screen.getByLabelText('搜索技能'), 'broken')

    expect(screen.queryByLabelText('查看技能 Review 详情')).not.toBeInTheDocument()
    expect(screen.getByLabelText('查看技能 Broken 详情')).toBeInTheDocument()
  })

  it('GitHub 导入入口在地址为空时不可提交', async () => {
    render(<SkillsSection />)

    // 「添加」是原生 <details>/<summary>（保留浏览器开合语义），弹出层里才是提交按钮
    await userEvent.click(screen.getByText('添加', { selector: 'summary' }))
    const input = screen.getByLabelText('GitHub 地址')
    const submit = screen
      .getAllByRole('button', { name: '添加' })
      .find((element) => element.tagName === 'BUTTON') as HTMLElement
    expect(submit).toBeDisabled()

    await userEvent.type(input, 'https://github.com/owner/repo')
    expect(submit).toBeEnabled()
  })

  it('添加菜单点击外部或按 Escape 会关闭', async () => {
    render(<SkillsSection />)
    const trigger = screen.getByText('添加', { selector: 'summary' })

    await userEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('heading', { name: '技能' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await userEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe('卸载插件的数据处置 - 危险分支必须有 danger 语义（文档 8.7）', () => {
  it('三个选择分别提交 keep / clear，取消不产生卸载', async () => {
    const onChoose = vi.fn()
    const onCancel = vi.fn()
    render(<PluginUninstallChoices onChoose={onChoose} onCancel={onCancel} />)

    await userEvent.click(screen.getByRole('button', { name: '卸载并保留数据' }))
    expect(onChoose).toHaveBeenLastCalledWith('keep')

    await userEvent.click(screen.getByRole('button', { name: '卸载并清除数据' }))
    expect(onChoose).toHaveBeenLastCalledWith('clear')

    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    // 取消只回退确认态，不会把任何处置方式提交出去
    expect(onChoose).toHaveBeenCalledTimes(2)
  })

  it('「清除数据」用 danger 语义表达危险，而不是只把文字染红', () => {
    render(<PluginUninstallChoices onChoose={vi.fn()} onCancel={vi.fn()} />)
    // antd 6 危险态类名出处：antd/es/button/button.js:227
    expect(screen.getByRole('button', { name: '卸载并清除数据' }).className).toContain('ant-btn-dangerous')
    // 保留数据不是危险操作，不应被染成危险色
    expect(screen.getByRole('button', { name: '卸载并保留数据' }).className).not.toContain('ant-btn-dangerous')
  })

  it('审计记录会保留的提示仍然可见', () => {
    render(<PluginUninstallChoices onChoose={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('审计记录会保留')).toBeInTheDocument()
  })
})

describe('技能行内操作 - 迁移到全局 Button 后仍能触达 store', () => {
  it('技能启用开关在详情弹窗内，是标准 switch 且把目标状态交给 store', async () => {
    skillState.items = [skill({ id: 'project:review', displayName: 'Review', enabled: true })]
    render(<SkillsSection />)

    // 列表行只负责打开详情，开关按 Codex 放在弹窗右上角
    await userEvent.click(screen.getByLabelText('查看技能 Review 详情'))
    const toggle = await screen.findByRole('switch', { name: '禁用 Review' })
    expect(toggle).toBeChecked()

    await userEvent.click(toggle)
    // 开关直接给出目标值，不再由调用方取反
    expect(skillState.setEnabled).toHaveBeenCalledWith('project:review', false)
  })

  it('清单有错的技能开关禁用，避免改坏加载失败的 Skill', async () => {
    skillState.items = [skill({ id: 'codex:broken', displayName: 'Broken', source: 'codex', errors: ['无法解析 frontmatter'] })]
    render(<SkillsSection />)

    await userEvent.click(screen.getByLabelText('查看技能 Broken 详情'))
    expect(await screen.findByRole('switch', { name: '禁用 Broken' })).toBeDisabled()
  })

  it('展开已安装技能后可检查更新与卸载，卸载带 danger 语义', async () => {
    skillState.items = [skill({
      id: 'installed:build', source: 'installed', displayName: 'Build',
      installUrl: 'https://example.com/build.tar.gz'
    })]
    render(<SkillsSection />)

    await userEvent.click(screen.getByLabelText('查看技能 Build 详情'))

    const update = await screen.findByRole('button', { name: '检查更新' })
    const uninstall = screen.getByRole('button', { name: '卸载' })
    expect(uninstall.className).toContain('ant-btn-dangerous')

    await userEvent.click(update)
    expect(skillState.install).toHaveBeenCalledWith('https://example.com/build.tar.gz')

    await userEvent.click(uninstall)
    expect(skillState.uninstall).toHaveBeenCalledWith('installed:build')

    // 卸载成功后弹窗自动关闭（与插件卸载同一约定），技术元数据随之不可见
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '卸载' })).not.toBeInTheDocument()
  })

  it('技能市场：点击条目打开弹窗，未安装时提供添加且不展示启用开关', async () => {
    skillState.catalog = [catalogItem({ id: 'market:pdf', displayName: 'PDF' })]
    render(<SkillsSection />)
    await userEvent.click(screen.getByRole('button', { name: '技能市场' }))

    await userEvent.click(await screen.findByLabelText('查看技能 PDF 详情'))
    const dialog = await screen.findByRole('dialog')

    // 未安装：右下角是「添加」
    expect(within(dialog).getByRole('button', { name: '添加' })).toBeEnabled()
    // 未安装：不应出现启用开关
    expect(within(dialog).queryByRole('switch')).not.toBeInTheDocument()
    // 也不应出现「立即试用」（那是已安装技能才有的动作）
    expect(within(dialog).queryByRole('button', { name: '立即试用' })).not.toBeInTheDocument()
  })

  it('技能市场弹窗已安装条目：按钮显示已添加并禁用', async () => {
    skillState.catalog = [catalogItem({ id: 'market:docx', displayName: 'DOCX', installed: true })]
    render(<SkillsSection />)
    await userEvent.click(screen.getByRole('button', { name: '技能市场' }))

    await userEvent.click(await screen.findByLabelText('查看技能 DOCX 详情'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '已添加' })).toBeDisabled()
  })

  it('技能市场弹窗可用 Escape 关闭', async () => {
    skillState.catalog = [catalogItem({ id: 'market:pdf', displayName: 'PDF' })]
    render(<SkillsSection />)
    await userEvent.click(screen.getByRole('button', { name: '技能市场' }))

    await userEvent.click(await screen.findByLabelText('查看技能 PDF 详情'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('技能市场行：未安装可添加，已安装的按钮禁用且带勾', async () => {
    skillState.catalog = [catalogItem({}), catalogItem({ id: 'market:docx', displayName: 'DOCX', installed: true })]

    render(<SkillsSection />)
    await userEvent.click(screen.getByRole('button', { name: '技能市场' }))

    // 页面上还有 GitHub 弹层里的「添加」，因此限定在市场区块内查询
    const market = screen.getByRole('heading', { name: '技能市场' }).closest('section') as HTMLElement
    const add = within(market).getByRole('button', { name: '添加' })
    expect(add).toBeEnabled()
    await userEvent.click(add)
    expect(skillState.install).toHaveBeenCalledWith('https://example.com/pdf.tar.gz')

    // 已安装项不能重复添加，且状态由文案与图标共同表达（不再是无名图标按钮）
    expect(within(market).getByRole('button', { name: '已添加' })).toBeDisabled()
  })
})

describe('插件详情弹层 - 关闭入口', () => {  it('打开后焦点落在关闭按钮上，回车即可关闭', async () => {
    const onClose = vi.fn()
    render(
      <PluginMarketDetails
        entry={marketEntry}
        releases={[marketEntry]}
        onClose={onClose}
        onConfirm={vi.fn()}
        mutating={false}
      />
    )

    const close = screen.getByRole('button', { name: '关闭插件详情' })
    expect(close).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape 仍然关闭弹层', async () => {
    const onClose = vi.fn()
    render(
      <PluginMarketDetails
        entry={marketEntry}
        releases={[marketEntry]}
        onClose={onClose}
        onConfirm={vi.fn()}
        mutating={false}
      />
    )

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
