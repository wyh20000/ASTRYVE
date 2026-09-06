import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { CreateSessionInput } from '@shared/types'
import { getStore } from '../db'
import { ok, err } from './result'
import { cancelGeneration } from '../services/generationTasks'
import { clearSessionWorkspace } from '../services/agent/workspaceManager'
import { cancelTasksForSession } from '../services/agent/taskRuntimeManager'
import { isVisibleMessage } from '../services/emptySessionCleanup'
import {
  assertTrustedIpcSender,
  validateCreateSessionInput,
  validateSessionId,
  validationErrorMessage
} from './validation'

let pendingBlankSession: Promise<Awaited<ReturnType<ReturnType<typeof getStore>['createSession']>>> | undefined

export function registerSessionIpc(): void {
  ipcMain.handle(IPC.session.list, async (event) => {
    try {
      assertTrustedIpcSender(event)
      return ok(await getStore().listSessions())
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.session.create, async (event, input?: CreateSessionInput) => {
    try {
      assertTrustedIpcSender(event)
      input = validateCreateSessionInput(input)
      const title = (input?.title ?? '').trim()
      if (!title) {
        if (!pendingBlankSession) {
          pendingBlankSession = findOrCreateBlankSession(input?.projectPath ?? null)
        }
        try { return ok(await pendingBlankSession) }
        finally { pendingBlankSession = undefined }
      }
      return ok(await getStore().createSession(title, input?.projectPath ?? null))
    } catch (e) {
      return err('INVALID_INPUT', validationErrorMessage(e))
    }
  })

  ipcMain.handle(IPC.session.rename, async (event, id: string, title: string) => {
    try {
      assertTrustedIpcSender(event)
      validateSessionId(id)
      if (typeof title !== 'string' || title.length > 512) throw new Error('会话标题无效')
      const s = await getStore().renameSession(id, title.trim())
      if (!s) return err('NOT_FOUND', 'session not found')
      return ok(s)
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.session.remove, async (event, id: string) => {
    try {
      assertTrustedIpcSender(event)
      validateSessionId(id)
      cancelGeneration(id, 'session_deleted')
      cancelTasksForSession(id, 'session_deleted')
      clearSessionWorkspace(id)
      await getStore().deleteSession(id)
      return ok({ id })
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.session.touch, async (event, id: string) => {
    try {
      assertTrustedIpcSender(event)
      validateSessionId(id)
      const s = await getStore().touchSession(id)
      if (!s) return err('NOT_FOUND', 'session not found')
      return ok(s)
    } catch (e) {
      return err('DB_ERR', String(e))
    }
  })
}

async function findOrCreateBlankSession(projectPath: string | null) {
  for (const session of (await getStore().listSessions()).slice(0, 10_000)) {
    if (session.title.trim()) continue
    const messages = await getStore().listMessages(session.id)
    if (!messages.some(isVisibleMessage)) return session
  }
  return getStore().createSession('', projectPath)
}
