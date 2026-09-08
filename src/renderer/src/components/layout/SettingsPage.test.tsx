import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillMetadata } from '@shared/types'
import { SkillsSection } from './SettingsPage'

const skillState = vi.hoisted(() => ({
  items: [] as SkillMetadata[], catalog: [], loading: false, mutating: false, error: undefined as string | undefined,
  load: vi.fn(), loadCatalog: vi.fn(), install: vi.fn(), importLocal: vi.fn(), uninstall: vi.fn(), setEnabled: vi.fn()
}))

vi.mock('../../stores/skillStore', () => ({
  useSkillStore: (selector: (state: typeof skillState) => unknown) => selector(skillState)
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
