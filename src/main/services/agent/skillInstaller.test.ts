import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { importSkillDirectory, installSkillFromGitHub, listSkillCatalog, uninstallSkill } from './skillInstaller'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })))
})

describe('Skill installer', () => {
  it('imports a multi-skill pack with companion files but never executes scripts', async () => {
    const root = await fs.promises.mkdtemp(join(os.tmpdir(), 'skill-import-'))
    roots.push(root)
    const source = join(root, 'pack', 'skills')
    const installed = join(root, 'installed')
    for (const name of ['grill-me', 'grilling']) {
      const directory = join(source, name)
      await fs.promises.mkdir(join(directory, 'scripts'), { recursive: true })
      await fs.promises.writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\ninstructions`)
      await fs.promises.writeFile(join(directory, 'scripts', 'must-not-run.js'), 'throw new Error("executed")')
    }
    expect(await importSkillDirectory(installed, join(root, 'pack'))).toEqual(['grill-me', 'grilling'])
    expect(await fs.promises.readFile(join(installed, 'grill-me', 'scripts', 'must-not-run.js'), 'utf8')).toContain('executed')
    const origin = JSON.parse(await fs.promises.readFile(join(installed, 'grill-me', '.aiagent-origin.json'), 'utf8'))
    expect(origin.installKind).toBe('local')
  })

  it('uninstalls only an exact app-managed skill into recoverable trash', async () => {
    const root = await fs.promises.mkdtemp(join(os.tmpdir(), 'skill-uninstall-'))
    roots.push(root)
    await fs.promises.mkdir(join(root, 'demo'), { recursive: true })
    await fs.promises.writeFile(join(root, 'demo', 'SKILL.md'), 'demo')
    await uninstallSkill(root, 'demo')
    await expect(fs.promises.stat(join(root, 'demo'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.promises.readdir(join(root, '.trash')))[0]).toMatch(/^demo-/)
    await expect(uninstallSkill(root, '../escape')).rejects.toThrow('名称无效')
  })

  it('pins a GitHub install to a commit and installs a referenced sibling dependency', async () => {
    const root = await fs.promises.mkdtemp(join(os.tmpdir(), 'skill-github-'))
    roots.push(root)
    const sha = 'a'.repeat(40)
    const files: Record<string, string> = {
      'skills/productivity/grill-me/SKILL.md': '---\nname: grill-me\ndescription: grill\ndisable-model-invocation: true\n---\nCall the Skill tool with "grilling".',
      'skills/productivity/grill-me/agents/openai.yaml': 'interface:\n  display_name: "Grill Me"',
      'skills/productivity/grilling/SKILL.md': '---\nname: grilling\ndescription: ask questions\n---\nAsk one question and wait.'
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/mattpocock/skills') return new Response(JSON.stringify({ default_branch: 'main', license: { spdx_id: 'MIT' } }), { status: 200 })
      if (url.includes('/commits/main')) return new Response(JSON.stringify({ sha }), { status: 200 })
      if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files).map((path) => ({
        path, type: 'blob', mode: '100644', size: files[path].length
      })) }), { status: 200 })
      const path = Object.keys(files).find((candidate) => url.endsWith(candidate.split('/').map(encodeURIComponent).join('/')))
      return path ? new Response(files[path], { status: 200 }) : new Response('', { status: 404 })
    }))
    const installed = join(root, 'installed')
    expect(await installSkillFromGitHub(installed,
      'https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me')).toEqual(['grill-me', 'grilling'])
    const origin = JSON.parse(await fs.promises.readFile(join(installed, 'grilling', '.aiagent-origin.json'), 'utf8'))
    expect(origin).toMatchObject({ repository: 'mattpocock/skills', version: sha, installKind: 'github', license: 'MIT' })
  })

  it('keeps featured marketplace entries searchable when the remote catalog is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    const items = await listSkillCatalog('grill')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'grill-me', featured: true, repository: 'mattpocock/skills' })
  })
})
