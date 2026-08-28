import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { CreateSessionInput } from '@shared/types'
import { getStore } from '../db'
import { ok, err } from './result'

export function registerSessionIpc(): void {
  ipcMain.handle(IPC.session.list, async () => {
    try {
      return ok(await getStore().listSessions())
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.session.create, async (_e, input?: CreateSessionInput) => {
    try {
      const title = (input?.title ?? '').trim()
      return ok(await getStore().createSession(title, input?.projectPath ?? null))
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.session.rename, async (_e, id: string, title: string) => {
    try {
      const s = await getStore().renameSession(id, title.trim())
      if (!s) return err('NOT_FOUND', 'session not found')
      return ok(s)
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.session.remove, async (_e, id: string) => {
    try {
      await getStore().deleteSession(id)
      return ok({ id })
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.session.touch, async (_e, id: string) => {
    try {
      const s = await getStore().touchSession(id)
      if (!s) return err('NOT_FOUND', 'session not found')
      return ok(s)
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })
}
