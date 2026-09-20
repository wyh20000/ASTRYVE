import { join, resolve, sep } from 'node:path'

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Account IDs only come from the authenticated service response. Never accept paths from Renderer. */
export function accountDataPath(baseUserData: string, userId: string): string {
  if (!USER_ID.test(userId)) throw new Error('账号标识无效')
  const root = resolve(baseUserData, 'accounts')
  const target = resolve(join(root, userId.toLowerCase()))
  if (!target.startsWith(root + sep)) throw new Error('账号目录无效')
  return target
}
