import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginMetadata, SkillMetadata } from '@shared/types'
import { ExtensionsSection, filterPlugins, PluginSection, SecuritySection, SkillsSection } from './SettingsPage'

const skillState = vi.hoisted(() => ({
  items: [] as SkillMetadata[], catalog: [], loading: false, mutating: false, error: undefined as string | undefined,
  load: vi.fn(), loadCatalog: vi.fn(), install: vi.fn(), importLocal: vi.fn(), uninstall: vi.fn(), setEnabled: vi.fn()
}))
const pluginState = vi.hoisted(() => ({
  items: [] as PluginMetadata[], loading: false, mutating: false, error: undefined as string | undefined,
  load: vi.fn(), importLocal: vi.fn(), setEnabled: vi.fn()
}))

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
})

describe('Security settings page', () => {
  it('offers a concise user-controlled audit cleanup action', () => {
    const html = renderToStaticMarkup(<SecuritySection />)
    expect(html).toContain('安全与数据')
    expect(html).toContain('清除审计记录')
    expect(html).not.toContain('agent-audit.json')
  })
})
