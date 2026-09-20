import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { session } from 'electron'
import { openPluginUi, registerPluginUiBridge } from './pluginUiWindow'

export async function runPluginUiSmoke(): Promise<void> {
  console.log('[plugin-ui-smoke] preparing fixture')
  const installed = await mkdtemp(join(tmpdir(), 'plugin-ui-smoke-'))
  const id = 'smoke.ui'
  const root = join(installed, id)
  try {
    await mkdir(join(root, 'ui'), { recursive: true })
    await writeFile(join(root, 'plugin.json'), JSON.stringify({
      schemaVersion: 1, id, name: 'Smoke UI', version: '1.0.0', ui: 'ui/index.html'
    }))
    await writeFile(join(root, 'ui', 'index.html'), '<h1>Plugin UI</h1><script>document.body.dataset.executed="yes"</script>')
    registerPluginUiBridge()
    console.log('[plugin-ui-smoke] opening isolated window')
    const win = await Promise.race([
      openPluginUi(installed, id),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('plugin UI load timeout')), 10_000))
    ])
    console.log('[plugin-ui-smoke] checking renderer isolation')
    if (win.webContents.session === session.defaultSession) throw new Error('plugin UI shared the application session')
    const executed = await withTimeout(win.webContents.executeJavaScript('document.body.dataset.executed'), 'page script') as string
    console.log('[plugin-ui-smoke] page script:', executed)
    const hasNode = await withTimeout(win.webContents.executeJavaScript("typeof require !== 'undefined' || typeof process !== 'undefined'"), 'Node isolation') as boolean
    const hasAppBridge = await withTimeout(win.webContents.executeJavaScript("typeof window.agent !== 'undefined'"), 'application bridge') as boolean
    const info = await withTimeout(win.webContents.executeJavaScript('window.pluginHost.getInfo()'), 'dedicated bridge') as { id: string; name: string }
    console.log('[plugin-ui-smoke] dedicated bridge:', info.id)
    const state = { executed, hasNode, hasAppBridge, info }
    if (state.executed !== 'yes' || state.hasNode || state.hasAppBridge ||
        state.info.id !== id || state.info.name !== 'Smoke UI') {
      throw new Error(`plugin UI isolation failed: ${JSON.stringify(state)}`)
    }
  } finally {
    await rm(installed, { recursive: true, force: true })
    console.log('[plugin-ui-smoke] cleaned up')
  }
}

function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  return Promise.race([operation, new Promise<never>((_resolve, reject) =>
    setTimeout(() => reject(new Error(`${label} timeout`)), 5_000))])
}
