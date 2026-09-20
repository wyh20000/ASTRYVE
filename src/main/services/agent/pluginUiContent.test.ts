import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readInstalledPluginUi, readPluginUiDocument } from './pluginUiContent'

async function fixture(ui = 'ui/index.html'): Promise<{ installed: string; root: string }> {
  const installed = await mkdtemp(join(tmpdir(), 'plugin-ui-content-'))
  const root = join(installed, 'example.ui')
  await mkdir(join(root, 'ui'), { recursive: true })
  await writeFile(join(root, 'plugin.json'), JSON.stringify({
    schemaVersion: 1, id: 'example.ui', name: 'Example UI', ui
  }))
  return { installed, root }
}

describe('plugin UI package boundary', () => {
  it('loads only the declared self-contained HTML from its own plugin', async () => {
    const { installed, root } = await fixture()
    try {
      await writeFile(join(root, 'ui', 'index.html'), '<h1>hello</h1>')
      expect(await readInstalledPluginUi(installed, 'example.ui')).toMatchObject({
        id: 'example.ui', name: 'Example UI', html: '<h1>hello</h1>'
      })
      await expect(readInstalledPluginUi(installed, '../example.ui')).rejects.toThrow('插件标识无效')
      await expect(readPluginUiDocument(root, '../outside.html')).rejects.toThrow('插件界面路径无效')
    } finally { await rm(installed, { recursive: true, force: true }) }
  })

  it('rejects missing, oversized and invalid UTF-8 UI documents', async () => {
    const { installed, root } = await fixture()
    try {
      await expect(readInstalledPluginUi(installed, 'example.ui')).rejects.toThrow()
      await writeFile(join(root, 'ui', 'index.html'), Buffer.alloc(256 * 1024 + 1))
      await expect(readInstalledPluginUi(installed, 'example.ui')).rejects.toThrow('过大')
      await writeFile(join(root, 'ui', 'index.html'), Buffer.from([0xff, 0xfe]))
      await expect(readInstalledPluginUi(installed, 'example.ui')).rejects.toThrow('UTF-8')
    } finally { await rm(installed, { recursive: true, force: true }) }
  })

  it('rejects a manifest UI path outside the ui directory', async () => {
    const { installed } = await fixture('../outside.html')
    try { await expect(readInstalledPluginUi(installed, 'example.ui')).rejects.toThrow('插件界面必须') }
    finally { await rm(installed, { recursive: true, force: true }) }
  })
})
