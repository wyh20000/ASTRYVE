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
import type { PluginMarketEntry, PluginMcpConnectInput, PluginMcpServerView, SkillCatalogItem, SkillMetadata } from '@shared/types'
import { PluginConnectionPanel, PluginMarketDetails, PluginUninstallChoices, SkillsSection } from './SettingsPage'

const skillState = vi.hoisted(() => ({
  items: [] as SkillMetadata[], catalog: [] as SkillCatalogItem[], loading: false, mutating: false, error: undefined as string | undefined,
  load: vi.fn(), loadCatalog: vi.fn(), install: vi.fn(), importLocal: vi.fn(), uninstall: vi.fn(), setEnabled: vi.fn()
}))

vi.mock('../../stores/skillStore', () => ({
  useSkillStore: (selector: (state: typeof skillState) => unknown) => selector(skillState)
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

    expect(screen.getByLabelText('禁用 Review')).toBeInTheDocument()
    expect(screen.getByLabelText('禁用 Broken')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('筛选 Skill 来源'))
    await userEvent.click(await screen.findByText('项目'))

    expect(screen.getByLabelText('禁用 Review')).toBeInTheDocument()
    expect(screen.queryByLabelText('禁用 Broken')).not.toBeInTheDocument()
  })

  it('搜索框仍按名称过滤列表', async () => {
    skillState.items = [
      skill({ id: 'project:review', displayName: 'Review' }),
      skill({ id: 'codex:broken', displayName: 'Broken', source: 'codex', description: '无法加载' })
    ]
    render(<SkillsSection />)

    await userEvent.type(screen.getByLabelText('搜索技能'), 'broken')

    expect(screen.queryByLabelText('禁用 Review')).not.toBeInTheDocument()
    expect(screen.getByLabelText('禁用 Broken')).toBeInTheDocument()
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
  it('技能启用开关是标准 switch，点一下把目标状态交给 store', async () => {
    skillState.items = [skill({ id: 'project:review', displayName: 'Review', enabled: true })]
    render(<SkillsSection />)

    const toggle = screen.getByRole('switch', { name: '禁用 Review' })
    expect(toggle).toBeChecked()

    await userEvent.click(toggle)
    // 开关直接给出目标值，不再由调用方取反
    expect(skillState.setEnabled).toHaveBeenCalledWith('project:review', false)
  })

  it('清单有错的技能开关禁用，避免改坏加载失败的 Skill', () => {
    skillState.items = [skill({ id: 'codex:broken', displayName: 'Broken', source: 'codex', errors: ['无法解析 frontmatter'] })]
    render(<SkillsSection />)

    expect(screen.getByRole('switch', { name: '禁用 Broken' })).toBeDisabled()
  })

  it('展开已安装技能后可检查更新与卸载，卸载带 danger 语义', async () => {
    skillState.items = [skill({
      id: 'installed:build', source: 'installed', displayName: 'Build',
      installUrl: 'https://example.com/build.tar.gz'
    })]
    render(<SkillsSection />)

    // 行首展开按钮的可访问名称就是整行文本
    await userEvent.click(screen.getByText('Build'))

    const update = await screen.findByRole('button', { name: '检查更新' })
    const uninstall = screen.getByRole('button', { name: '卸载' })
    expect(uninstall.className).toContain('ant-btn-dangerous')

    await userEvent.click(update)
    expect(skillState.install).toHaveBeenCalledWith('https://example.com/build.tar.gz')

    await userEvent.click(uninstall)
    expect(skillState.uninstall).toHaveBeenCalledWith('installed:build')

    // 再点一次收起，展开态由行首按钮独占控制
    await userEvent.click(screen.getByText('Build'))
    expect(screen.queryByRole('button', { name: '卸载' })).not.toBeInTheDocument()
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
