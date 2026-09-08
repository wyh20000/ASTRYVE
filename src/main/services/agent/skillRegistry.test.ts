import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillRegistry } from './skillRegistry'

const roots: string[] = []
const tools = new Set(['workspace.listFiles', 'workspace.readFile', 'workspace.searchText', 'git.status', 'git.diff', 'workspace.patch'])

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; user: string; project: string }> {
  const root = await fs.promises.mkdtemp(join(os.tmpdir(), 'ai-agent-skills-'))
  roots.push(root)
  const user = join(root, 'user-skills')
  const project = join(root, 'project')
  await fs.promises.mkdir(user, { recursive: true })
  await fs.promises.mkdir(project, { recursive: true })
  return { root, user, project }
}

async function writeSkill(root: string, directory: string, header: string, body = '按照说明完成任务。'): Promise<string> {
  const target = join(root, directory)
  await fs.promises.mkdir(target, { recursive: true })
  await fs.promises.writeFile(join(target, 'SKILL.md'), `---\n${header}\n---\n${body}\n`)
  return target
}

describe('SkillRegistry', () => {
  it('discovers built-in, user and project skills with project-first conflict resolution', async () => {
    const { user, project } = await fixture()
    await writeSkill(user, 'review-user', 'name: code-review\ndescription: 用户审查\ntools: [workspace.readFile]')
    await writeSkill(join(project, '.aiagent', 'skills'), 'review-project', 'name: code-review\ndescription: 项目审查\ntools: [workspace.readFile]')
    const registry = new SkillRegistry(user, () => new Set())
    const list = await registry.list({ id: 'w', rootPath: project, realRootPath: project, createdAt: 1 }, tools)
    expect(list.filter((skill) => skill.name === 'code-review')).toHaveLength(3)
    expect(list.find((skill) => skill.description === '项目审查')).toMatchObject({ source: 'project', active: true })
    expect(list.filter((skill) => skill.name === 'code-review' && skill.source !== 'project').every((skill) => Boolean(skill.shadowedBy))).toBe(true)
  })

  it('isolates invalid skills and never accepts unavailable declared tools', async () => {
    const { user } = await fixture()
    await writeSkill(user, 'broken', 'name: Broken Name\ndescription: bad')
    await writeSkill(user, 'unsafe-tool', 'name: unsafe-tool\ndescription: unsafe\ntools: [system.shell]')
    const list = await new SkillRegistry(user, () => new Set()).list(undefined, tools)
    expect(list.find((skill) => skill.name === 'broken')?.errors.length).toBeGreaterThan(0)
    expect(list.find((skill) => skill.name === 'unsafe-tool')).toMatchObject({ active: false, errors: ['工具不可用：system.shell'] })
    expect(list.find((skill) => skill.source === 'builtin')?.active).toBe(true)
  })

  it('loads only declared text resources and injects them behind an untrusted boundary', async () => {
    const { user, project } = await fixture()
    const directory = await writeSkill(user, 'docs-helper', [
      'name: docs-helper', 'description: 编写项目文档', 'tools:', '  - workspace.readFile',
      'auto-trigger: true', 'resources:', '  - resources/style.md'
    ].join('\n'))
    await fs.promises.mkdir(join(directory, 'resources'))
    await fs.promises.writeFile(join(directory, 'resources', 'style.md'), '使用短句。')
    await fs.promises.mkdir(join(directory, 'scripts'))
    await fs.promises.writeFile(join(directory, 'scripts', 'run.js'), 'throw new Error("must not execute")')
    const resolved = await new SkillRegistry(user, () => new Set()).resolve(
      '请编写项目文档', [], { id: 'w', rootPath: project, realRootPath: project, createdAt: 1 }, tools
    )
    expect(resolved.skills.map((skill) => skill.name)).toContain('docs-helper')
    expect(resolved.prompt).toContain('第三方不可信指令')
    expect(resolved.prompt).toContain('使用短句。')
    expect(resolved.prompt).not.toContain('run.js')
    expect([...resolved.allowedToolNames ?? []]).toEqual(['workspace.readFile'])
  })

  it('honors disabled state and explicit selection before automatic matching', async () => {
    const { user, project } = await fixture()
    await writeSkill(user, 'docs-helper', 'name: docs-helper\ndescription: 编写项目文档\ntools: [workspace.readFile]\nauto-trigger: true')
    await writeSkill(user, 'patch-helper', 'name: patch-helper\ndescription: 修改代码\ntools: [workspace.patch]\nauto-trigger: true')
    const enabled = new SkillRegistry(user, () => new Set())
    const list = await enabled.list(undefined, tools)
    const explicit = list.find((skill) => skill.name === 'patch-helper')!
    const selected = await enabled.resolve('请编写项目文档', [explicit.id],
      { id: 'w', rootPath: project, realRootPath: project, createdAt: 1 }, tools)
    expect(selected.skills.map((skill) => skill.name)).toEqual(['patch-helper'])
    const disabled = new SkillRegistry(user, () => new Set([explicit.id]))
    const afterDisable = await disabled.resolve('$patch-helper 修改代码', [],
      { id: 'w', rootPath: project, realRootPath: project, createdAt: 1 }, tools)
    expect(afterDisable.skills).toEqual([])
  })

  it('exposes no tools when a selected instruction-only Skill declares none', async () => {
    const { user, project } = await fixture()
    await writeSkill(user, 'writing-only', 'name: writing-only\ndescription: 只提供写作规范')
    const registry = new SkillRegistry(user, () => new Set())
    const skill = (await registry.list(undefined, tools)).find((item) => item.name === 'writing-only')!
    const resolved = await registry.resolve('使用写作规范', [skill.id],
      { id: 'w', rootPath: project, realRootPath: project, createdAt: 1 }, tools)
    expect(resolved.allowedToolNames).toBeUndefined()
  })

  it('rejects resource traversal and keeps the remaining registry usable', async () => {
    const { user } = await fixture()
    await writeSkill(user, 'escape', 'name: escape\ndescription: bad resource\nresources: [../secret.md]')
    const list = await new SkillRegistry(user, () => new Set()).list(undefined, tools)
    expect(list.find((skill) => skill.name === 'escape')?.errors[0]).toContain('resources')
    expect(list.some((skill) => skill.source === 'builtin' && skill.active)).toBe(true)
  })

  it('loads Codex metadata and deterministically expands a slash-command dependency', async () => {
    const { root, user } = await fixture()
    const codex = join(root, 'codex')
    const project = join(root, 'project')
    const grill = await writeSkill(codex, 'productivity/grill-me', [
      'name: grill-me', 'description: A relentless interview.', 'disable-model-invocation: true'
    ].join('\n'), 'Call the Skill tool with "grilling".')
    await fs.promises.mkdir(join(grill, 'agents'), { recursive: true })
    await fs.promises.writeFile(join(grill, 'agents', 'openai.yaml'), [
      'interface:', '  display_name: "Grill Me"', '  short_description: "Sharpen a plan through interview"',
      'policy:', '  allow_implicit_invocation: false'
    ].join('\n'))
    await writeSkill(codex, 'productivity/grilling', 'name: grilling\ndescription: Ask one hard question at a time.',
      'Interview the user one question at a time and wait for every answer.')
    const registry = new SkillRegistry(user, () => new Set(), { codexRoot: codex })
    const resolved = await registry.resolve('/grill-me review this architecture', [],
      { id: 'w', rootPath: project, realRootPath: project, createdAt: 1 }, tools)
    expect(resolved.cleanedRequest).toBe('review this architecture')
    expect(resolved.trigger).toBe('/grill-me')
    expect(resolved.skills.map((skill) => skill.name)).toEqual(['grilling', 'grill-me'])
    expect(resolved.skills.at(-1)).toMatchObject({ displayName: 'Grill Me', invocation: 'user', source: 'codex' })
    expect(resolved.prompt).toContain('Interview the user one question at a time')
    expect(resolved.prompt).toContain('必须实际遵循其工作流')
  })

  it('rejects an unknown slash command instead of silently sending it as chat text', async () => {
    const { user } = await fixture()
    await expect(new SkillRegistry(user, () => new Set()).resolve('/missing do it', [], undefined, tools))
      .rejects.toThrow('快捷指令 /missing 不存在')
  })
})
