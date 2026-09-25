import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { CreateSessionInput } from '@shared/types'
import { collectOrphanArtifacts, getStore } from '../db'
import { ok, err } from './result'
import { cancelGeneration } from '../services/generationTasks'
import { activateSessionWorkspace, clearSessionWorkspace, getWorkspaceService, sameProjectPath } from '../services/agent/workspaceManager'
import { cancelTasksForSession } from '../services/agent/taskRuntimeManager'
import { isVisibleMessage } from '../services/visibleMessage'
import {
  assertTrustedIpcSender,
  validateCreateSessionInput,
  validateSessionId,
  validationErrorMessage
} from './validation'

const pendingBlankSessions = new Map<string, Promise<Awaited<ReturnType<ReturnType<typeof getStore>['createSession']>>>>()

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
      const workspaceId = input.workspaceId ?? null
      const workspace = workspaceId ? await getWorkspaceService().activate(workspaceId) : null
      const projectPath = workspace?.displayPath ?? null
      if (!title) {
        const key = workspaceId ?? 'chat'
        let pending = pendingBlankSessions.get(key)
        if (!pending) {
          pending = findOrCreateBlankSession(projectPath, workspaceId)
          pendingBlankSessions.set(key, pending)
        }
        try {
          const session = await pending
          if (workspaceId) await activateSessionWorkspace(session.id, workspaceId)
          return ok(session)
        } finally { pendingBlankSessions.delete(key) }
      }
      const session = await getStore().createSession(title, projectPath, workspaceId)
      if (workspaceId) await activateSessionWorkspace(session.id, workspaceId)
      return ok(session)
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
      // A concurrent send in another session may have written bytes but not yet committed its message.
      // Reclaim older orphans now; startup GC reclaims the grace-period remainder.
      await collectOrphanArtifacts(getStore(), 5 * 60_000).catch((error) => {
        console.warn('[artifact] orphan cleanup failed:', error)
      })
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

async function findOrCreateBlankSession(projectPath: string | null, workspaceId: string | null) {
  for (const session of (await getStore().listSessions()).slice(0, 10_000)) {
    if (session.title.trim()) continue
    if ((session.kind ?? (session.projectPath ? 'work' : 'chat')) !== (workspaceId ? 'work' : 'chat')) continue
    if ((session.workspaceId ?? null) !== workspaceId) continue
    if (workspaceId && (!session.projectPath || !projectPath || !sameProjectPath(session.projectPath, projectPath))) continue
    const messages = await getStore().listMessages(session.id)
    if (!messages.some(isVisibleMessage)) return session
  }
  return getStore().createSession('', projectPath, workspaceId)
}
