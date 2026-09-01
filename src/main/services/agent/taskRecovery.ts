import fs from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { isEntityId } from './validation'

/** 仅清理由 journal 明确标记为 stale 的专用任务目录。 */
export async function cleanupStaleTaskResources(
  taskTempRoot: string,
  staleTaskIds: readonly string[]
): Promise<number> {
  const root = resolve(taskTempRoot)
  let removed = 0
  for (const taskId of new Set(staleTaskIds)) {
    if (!isEntityId(taskId)) continue
    const target = resolve(root, taskId)
    if (!isContained(root, target)) continue
    let stat: fs.Stats
    try {
      stat = await fs.promises.lstat(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (stat.isSymbolicLink()) await fs.promises.unlink(target)
    else if (stat.isDirectory()) {
      const realTarget = await fs.promises.realpath(target)
      if (!isContained(root, resolve(realTarget))) continue
      await fs.promises.rm(target, { recursive: true, force: true })
    } else {
      await fs.promises.rm(target, { force: true })
    }
    removed += 1
  }
  return removed
}

export function taskTempDirectory(taskTempRoot: string, taskId: string): string {
  if (!isEntityId(taskId)) throw new Error('Invalid task id')
  const root = resolve(taskTempRoot)
  const target = resolve(join(root, taskId))
  if (!isContained(root, target)) throw new Error('Task temp directory escaped its root')
  return target
}

function isContained(root: string, target: string): boolean {
  const value = relative(root, target)
  return value.length > 0 && value !== '..' && !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
}
