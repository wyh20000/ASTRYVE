import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { uninstallPlugin } from './pluginUninstall'

const exists = async (path: string): Promise<boolean> => access(path).then(() => true, () => false)

describe('plugin uninstall data boundary', () => {
  it('always removes code, preserves audit, and clears only plugin-owned data when requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-uninstall-'))
    const installed = join(root, 'plugins')
    const id = 'acme.tools'
    for (const path of [join(installed, id), join(root, 'plugin-history', id), join(root, 'plugin-data', id), join(root, 'plugin-cache', id)]) {
      await mkdir(path, { recursive: true }); await writeFile(join(path, 'value'), 'kept')
    }
    await writeFile(join(root, 'agent-audit.json'), 'audit')
    const stop = vi.fn(async () => undefined)
    const disposeConnections = vi.fn(async () => undefined)

    await uninstallPlugin(id, 'keep', root, installed, { stop, disposeConnections })
    expect(await exists(join(installed, id))).toBe(false)
    expect(await exists(join(root, 'plugin-history', id))).toBe(false)
    expect(await exists(join(root, 'plugin-data', id))).toBe(true)
    expect(await exists(join(root, 'agent-audit.json'))).toBe(true)

    await mkdir(join(installed, id), { recursive: true })
    await uninstallPlugin(id, 'clear', root, installed, { stop, disposeConnections })
    expect(await exists(join(root, 'plugin-history', id))).toBe(false)
    expect(await exists(join(root, 'plugin-data', id))).toBe(false)
    expect(await exists(join(root, 'plugin-cache', id))).toBe(false)
    expect(await exists(join(root, 'agent-audit.json'))).toBe(true)
    expect(disposeConnections.mock.calls).toEqual([[id, 'keep'], [id, 'clear']])
  })

  it('rejects path-like plugin identifiers before touching storage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-uninstall-invalid-'))
    await expect(uninstallPlugin('../escape', 'clear', root, join(root, 'plugins'), {
      stop: async () => undefined, disposeConnections: async () => undefined
    })).rejects.toThrow('插件标识无效')
  })
})
