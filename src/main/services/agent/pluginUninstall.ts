import { rm } from 'node:fs/promises'
import { join } from 'node:path'

export type PluginDataDisposition = 'keep' | 'clear'

export async function uninstallPlugin(
  id: string,
  dataDisposition: PluginDataDisposition,
  dataRoot: string,
  installedRoot: string,
  dependencies: {
    stop: (id: string) => Promise<void>
    disposeConnections: (id: string, disposition: PluginDataDisposition) => Promise<void>
  }
): Promise<void> {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error('插件标识无效')
  if (dataDisposition !== 'keep' && dataDisposition !== 'clear') throw new Error('插件数据处理方式无效')
  await dependencies.stop(id)
  await Promise.all([
    rm(join(installedRoot, id), { recursive: true, force: true }),
    rm(join(dataRoot, 'plugin-history', id), { recursive: true, force: true })
  ])
  await dependencies.disposeConnections(id, dataDisposition)
  if (dataDisposition === 'clear') {
    await Promise.all([
      rm(join(dataRoot, 'plugin-data', id), { recursive: true, force: true }),
      rm(join(dataRoot, 'plugin-cache', id), { recursive: true, force: true })
    ])
  }
}
