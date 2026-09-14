import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginConnectionStore } from './pluginConnectionStore'
import { initPluginRegistry } from './pluginManager'
import { createInstalledPluginConnectionManager } from './pluginMcpRuntime'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('installed plugin MCP runtime', () => {
  it('resolves declarations from the installed package and snapshots bound tools', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'ai-agent-mcp-runtime-'))
    roots.push(dataRoot)
    const pluginRoot = join(dataRoot, 'plugins', 'acme.remote')
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(pluginRoot, 'plugin.json'), JSON.stringify({
      schemaVersion: 1, id: 'acme.remote', name: 'Remote', version: '1.0.0',
      permissions: ['network'], mcp: './mcp.json'
    }))
    await writeFile(join(pluginRoot, 'mcp.json'), JSON.stringify({
      mcpServers: { api: { url: 'https://api.example.com/mcp', auth: 'none' } }
    }))
    initPluginRegistry(dataRoot)
    const store = new PluginConnectionStore(dataRoot)
    const connection = await store.saveConnection({
      serverOrigin: 'https://api.example.com',
      serverUrl: 'https://api.example.com/mcp', auth: 'none', state: 'connected'
    })
    await store.bindPlugin({ pluginId: 'acme.remote', serverId: 'api', connectionId: connection.id })
    const manager = createInstalledPluginConnectionManager(dataRoot, () => ({
      connect: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
      listTools: vi.fn(async () => [{ name: 'search', inputSchema: {
        type: 'object', properties: {}, additionalProperties: false
      } }]),
      callTool: vi.fn()
    }))

    await expect(manager.snapshotPluginTools('acme.remote')).resolves.toEqual([expect.objectContaining({
      serverId: 'api', connectionId: connection.id, serverOrigin: 'https://api.example.com',
      tools: [expect.objectContaining({ name: 'search' })]
    })])
    await manager.close()
  })
})
