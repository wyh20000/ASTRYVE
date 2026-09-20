import { lstat, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { readPluginManifest } from './pluginManifest'

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/
const MAX_ICON_BYTES = 256 * 1024

/** Only the package-declared icon can cross into the renderer. Never accept a renderer path. */
export async function readPluginIcon(installedRoot: string, id: string): Promise<string | undefined> {
  return readDeclaredAsset(installedRoot, id)
}

/** Generic static image endpoint. The requested path must appear in the package manifest. */
export async function readPluginAsset(installedRoot: string, id: string, path: string): Promise<string> {
  if (typeof path !== 'string') throw new Error('插件静态资源路径无效')
  const asset = await readDeclaredAsset(installedRoot, id, path)
  if (!asset) throw new Error('插件静态资源未声明')
  return asset
}

async function readDeclaredAsset(installedRoot: string, id: string, requestedPath?: string): Promise<string | undefined> {
  if (!PLUGIN_ID.test(id)) throw new Error('插件标识无效')
  const root = join(installedRoot, id)
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('插件目录无效')
  const manifest = await readPluginManifest(root)
  if (manifest.id !== id) throw new Error('插件标识与安装目录不一致')
  if (requestedPath !== undefined && !manifest.assetPaths.includes(requestedPath) && requestedPath !== manifest.iconPath) {
    throw new Error('插件静态资源未声明')
  }
  const declaredPath = requestedPath ?? manifest.iconPath
  if (!declaredPath) return undefined

  const parts = declaredPath.split('/')
  let target = root
  for (const [index, part] of parts.entries()) {
    target = join(target, part)
    const info = await lstat(target)
    if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory())) {
      throw new Error('插件图标路径无效')
    }
    if (index === parts.length - 1 && (!info.isFile() || info.size > MAX_ICON_BYTES)) {
      throw new Error('插件图标文件无效或过大')
    }
  }

  const bytes = await readFile(target)
  if (bytes.length > MAX_ICON_BYTES) throw new Error('插件图标文件过大')
  const extension = extname(target).toLowerCase()
  const mime = extension === '.png' && isPng(bytes) ? 'image/png'
    : (extension === '.jpg' || extension === '.jpeg') && isJpeg(bytes) ? 'image/jpeg'
      : extension === '.webp' && isWebp(bytes) ? 'image/webp' : undefined
  if (!mime) throw new Error('插件图标内容与文件类型不符')
  return `data:${mime};base64,${bytes.toString('base64')}`
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
}

function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
}
