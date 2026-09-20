import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readPluginManifest } from './pluginManifest'

const MAX_UI_BYTES = 256 * 1024
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/

/** Validate packaged UI without executing it during import or discovery. */
export async function readPluginUiDocument(root: string, uiPath: string): Promise<string> {
  if (!/^ui\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.html$/i.test(uiPath)) {
    throw new Error('插件界面路径无效')
  }
  let target = root
  const parts = uiPath.split('/')
  for (const [index, part] of parts.entries()) {
    target = join(target, part)
    const info = await lstat(target)
    if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory())) {
      throw new Error('插件界面路径无效')
    }
    if (index === parts.length - 1 && (!info.isFile() || info.size > MAX_UI_BYTES)) {
      throw new Error('插件界面文件无效或过大')
    }
  }
  const bytes = await readFile(target)
  if (bytes.length > MAX_UI_BYTES) throw new Error('插件界面文件过大')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('插件界面不是有效 UTF-8') }
}

export async function readInstalledPluginUi(installedRoot: string, id: string): Promise<{
  id: string; name: string; version?: string; html: string
}> {
  if (!PLUGIN_ID.test(id)) throw new Error('插件标识无效')
  const root = join(installedRoot, id)
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('插件目录无效')
  const manifest = await readPluginManifest(root)
  if (manifest.id !== id || !manifest.uiPath) throw new Error('插件未声明隔离界面')
  return { id, name: manifest.name, version: manifest.version,
    html: await readPluginUiDocument(root, manifest.uiPath) }
}
