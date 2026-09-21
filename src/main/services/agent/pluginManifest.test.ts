import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { readPluginManifest } from './pluginManifest'

async function fixture(manifest: unknown, legacy = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ai-agent-plugin-'))
  const dir = legacy ? join(root, '.codex-plugin') : root
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'plugin.json'), JSON.stringify(manifest), 'utf8')
  return root
}

describe('readPluginManifest', () => {
  it('accepts at most 128 closed tool schemas and rejects larger catalogs', async () => {
    const makeTools = (count: number) => Array.from({ length: count }, (_, index) => ({
      name: `tool_${index}`, description: `Tool ${index}`, entry: `tools/tool-${index}.js`, operation: 'fs.read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }
    }))
    const accepted = await fixture({
      schemaVersion: 1, id: 'many.tools', name: 'Many Tools', version: '1.0.0',
      permissions: ['workspace.read'], tools: makeTools(128)
    })
    await expect(readPluginManifest(accepted)).resolves.toMatchObject({ tools: expect.arrayContaining([
      expect.objectContaining({ name: 'tool_127' })
    ]) })

    const rejected = await fixture({
      schemaVersion: 1, id: 'too-many.tools', name: 'Too Many Tools', version: '1.0.0',
      permissions: ['workspace.read'], tools: makeTools(129)
    })
    await expect(readPluginManifest(rejected)).rejects.toThrow('插件工具数量超过限制')
  })

  it('normalizes the top-level Codex plugin format without executing package code', async () => {
    const root = await fixture({
      name: 'review-tools', version: '1.2.3', description: 'Review project changes',
      author: { name: 'Example' }, skills: './skills/', hooks: {},
      interface: { displayName: 'Review Tools', capabilities: ['Read', 'Interactive'], dataTargets: ['workspace', 'selection'] }
    }, true)

    await expect(readPluginManifest(root)).resolves.toMatchObject({
      id: 'review-tools', name: 'Review Tools', version: '1.2.3', author: 'Example',
      sourceFormat: 'codex', capabilities: ['Interactive', 'Read'], dataTargets: ['selection', 'workspace'], components: ['skills'], skillsPath: './skills/'
    })
  })

  it('recognizes the public Codex mcpServers component name', async () => {
    const root = await fixture({
      name: 'connected-tools', version: '1.0.0', description: 'Connected tools', mcpServers: './.mcp.json'
    }, true)
    await expect(readPluginManifest(root)).resolves.toMatchObject({ components: ['mcp'] })
  })

  it('retains a validated MCP file path without loading it during discovery', async () => {
    const root = await fixture({
      schemaVersion: 1, id: 'remote.tools', name: 'Remote', description: 'Remote tools', mcp: './mcp.json'
    })

    await expect(readPluginManifest(root)).resolves.toMatchObject({ components: ['mcp'], mcpPath: './mcp.json' })
  })

  it('accepts the native manifest and rejects traversal in component paths', async () => {
    const valid = await fixture({
      schemaVersion: 1, id: 'acme.browser', name: 'Acme Browser', version: '1.0.0',
      description: 'Browser inspection tools', permissions: ['browser.read'],
      skills: './skills'
    })
    await expect(readPluginManifest(valid)).resolves.toMatchObject({ id: 'acme.browser', permissions: ['browser.read'] })

    const invalid = await fixture({
      schemaVersion: 1, id: 'escape', name: 'Escape', version: '1.0.0',
      description: 'Invalid package', skills: '../outside'
    })
    await expect(readPluginManifest(invalid)).rejects.toThrow('插件路径必须位于插件目录内')
  })

  it('normalizes executable tool schemas without loading their entries', async () => {
    const root = await fixture({
      schemaVersion: 1, id: 'acme.tools', name: 'Acme Tools', version: '1.0.0',
      description: 'Tools', permissions: ['workspace.read'], tools: [{
        name: 'inspect', description: 'Inspect a file', entry: './tools/inspect.mjs', operation: 'fs.read',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }
      }]
    })
    await expect(readPluginManifest(root)).resolves.toMatchObject({ tools: [{ name: 'inspect', operation: 'fs.read' }] })
  })

  it('normalizes only allowlisted lifecycle hooks with bounded priority and timeout', async () => {
    const root = await fixture({
      schemaVersion: 1, id: 'acme.hooks', name: 'Acme Hooks', version: '1.0.0', description: 'Hooks',
      hooks: {
        'task.created': [
          { entry: './hooks/prepare.mjs', priority: 20, timeoutMs: 750 },
          { entry: './hooks/observe.mjs' }
        ],
        'tool.completed': [{ entry: './hooks/tool.mjs', priority: -10, timeoutMs: 1500 }]
      }
    })
    await expect(readPluginManifest(root)).resolves.toMatchObject({
      components: ['hooks'], hooks: [
        { event: 'task.created', entry: './hooks/prepare.mjs', priority: 20, timeoutMs: 750 },
        { event: 'task.created', entry: './hooks/observe.mjs', priority: 0, timeoutMs: 1000 },
        { event: 'tool.completed', entry: './hooks/tool.mjs', priority: -10, timeoutMs: 1500 }
      ]
    })
  })

  it('rejects unknown hook events, traversal, and unbounded hook settings', async () => {
    const unknown = await fixture({ schemaVersion: 1, id: 'bad.hook', name: 'Bad', description: 'Bad', hooks: {
      'approval.required': [{ entry: './hooks/approval.mjs' }]
    } })
    await expect(readPluginManifest(unknown)).rejects.toThrow('Hook 事件无效')
    const traversal = await fixture({ schemaVersion: 1, id: 'bad.path', name: 'Bad', description: 'Bad', hooks: {
      'task.created': [{ entry: '../outside.mjs' }]
    } })
    await expect(readPluginManifest(traversal)).rejects.toThrow('插件路径必须位于插件目录内')
    const timeout = await fixture({ schemaVersion: 1, id: 'bad.timeout', name: 'Bad', description: 'Bad', hooks: {
      'task.created': [{ entry: './hook.mjs', timeoutMs: 6000 }]
    } })
    await expect(readPluginManifest(timeout)).rejects.toThrow('Hook 超时无效')
  })

  it('rejects unsupported executable aliases, duplicate tools and componentless packages', async () => {
    const alias = await fixture({ schemaVersion: 1, id: 'alias', name: 'Alias', version: '1.0.0', description: 'Alias', skills: './skills', main: './index.js' })
    await expect(readPluginManifest(alias)).rejects.toThrow('不受支持的可执行入口')
    const duplicate = await fixture({ schemaVersion: 1, id: 'duplicate', name: 'Duplicate', version: '1.0.0', description: 'Duplicate', tools: [
      { name: 'inspect', entry: './one.js' }, { name: 'inspect', entry: './two.js' }
    ] })
    await expect(readPluginManifest(duplicate)).rejects.toThrow('插件工具名称重复或无效')
    const empty = await fixture({ schemaVersion: 1, id: 'empty', name: 'Empty', version: '1.0.0', description: 'Empty' })
    await expect(readPluginManifest(empty)).rejects.toThrow('未声明任何可用组件')
    const external = await fixture({
      schemaVersion: 1, id: 'external', name: 'External', version: '1.0.0', description: 'External',
      permissions: ['network'], tools: [{
        name: 'escape', description: 'Bypass host MCP', entry: './escape.js', operation: 'external.call',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }]
    })
    await expect(readPluginManifest(external)).rejects.toThrow('宿主专用')
  })

  it('rejects absolute URLs, oversized manifests and linked package roots', async () => {
    const remote = await fixture({ schemaVersion: 1, id: 'remote', name: 'Remote', version: '1.0.0', description: 'Remote', skills: 'https://example.com/skills' })
    await expect(readPluginManifest(remote)).rejects.toThrow('插件路径必须位于插件目录内')

    const oversized = await fixture({ schemaVersion: 1, id: 'large', name: 'Large', version: '1.0.0', description: 'x'.repeat(257 * 1024), skills: './skills' })
    await expect(readPluginManifest(oversized)).rejects.toThrow('插件清单过大')

    const target = await fixture({ schemaVersion: 1, id: 'linked', name: 'Linked', version: '1.0.0', description: 'Linked', skills: './skills' })
    const parent = await mkdtemp(join(tmpdir(), 'ai-agent-plugin-link-'))
    const linked = join(parent, 'linked')
    await symlink(target, linked, 'junction')
    await expect(readPluginManifest(linked)).rejects.toThrow('插件目录无效')
  })

  it('rejects undeclared permissions and ambiguous manifests', async () => {
    const root = await fixture({ schemaVersion: 1, id: 'bad', name: 'Bad', version: '1.0.0', description: 'Bad', permissions: ['everything'], skills: './skills' })
    await expect(readPluginManifest(root)).rejects.toThrow('插件权限无效')

    await mkdir(join(root, '.codex-plugin'), { recursive: true })
    await writeFile(join(root, '.codex-plugin', 'plugin.json'), '{}', 'utf8')
    await expect(readPluginManifest(root)).rejects.toThrow('存在多个插件清单')
  })
})
