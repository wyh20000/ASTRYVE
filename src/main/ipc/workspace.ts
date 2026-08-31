import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ActivateWorkspaceInput,
  WorkspaceListInput,
  WorkspaceReadInput,
  WorkspaceReadManyInput,
  WorkspaceSearchInput
} from '@shared/agent'
import { getStore } from '../db'
import { cancelGeneration } from '../services/generationTasks'
import {
  activateSessionWorkspace,
  getWorkspaceService,
  onSessionWorkspaceSwitched
} from '../services/agent/workspaceManager'
import { WorkspaceError } from '../services/agent/workspace'
import { err, ok } from './result'
import {
  InputValidationError,
  assertTrustedIpcSender,
  validateSessionId,
  validateWorkspaceId,
  validateWorkspaceRelativePath,
  validationErrorMessage
} from './validation'

function workspaceFailure(error: unknown) {
  if (error instanceof WorkspaceError) return err(error.code, error.message)
  if (error instanceof InputValidationError) {
    return err('INVALID_INPUT', validationErrorMessage(error))
  }
  console.warn('[workspace] operation failed:', error instanceof Error ? error.message : String(error))
  return err('WORKSPACE_ERROR', '工作区操作失败，请确认项目仍然可访问')
}

export function registerWorkspaceIpc(): void {
  onSessionWorkspaceSwitched((sessionId) => {
    cancelGeneration(sessionId, 'workspace_switched')
  })
  ipcMain.handle(IPC.workspace.recent, (event) => {
    try {
      assertTrustedIpcSender(event)
      return ok(getWorkspaceService().listRecent())
    } catch (error) {
      return workspaceFailure(error)
    }
  })

  ipcMain.handle(IPC.workspace.select, async (event) => {
    try {
      assertTrustedIpcSender(event)
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: '选择项目工作区',
        buttonLabel: '选择项目',
        properties: ['openDirectory']
      }
      const selection = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      if (selection.canceled || !selection.filePaths[0]) return ok(null)
      return ok(await getWorkspaceService().createGrant(selection.filePaths[0]))
    } catch (error) {
      return workspaceFailure(error)
    }
  })

  ipcMain.handle(IPC.workspace.activate, async (event, input?: ActivateWorkspaceInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input !== 'object') return err('INVALID_INPUT', '工作区参数无效')
      const sessionId = validateSessionId(input.sessionId)
      const workspaceId = validateWorkspaceId(input.workspaceId)
      const workspace = await activateSessionWorkspace(sessionId, workspaceId)
      const session = await getStore().setSessionProjectPath(sessionId, workspace.displayPath)
      if (!session) return err('NOT_FOUND', '会话不存在')
      return ok({ workspace, session })
    } catch (error) {
      return workspaceFailure(error)
    }
  })

  ipcMain.handle(IPC.workspace.listFiles, async (event, input?: WorkspaceListInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input !== 'object') return err('INVALID_INPUT', '工作区参数无效')
      return ok(
        await getWorkspaceService().listFiles(
          validateWorkspaceId(input.workspaceId),
          validateWorkspaceRelativePath(input.path, true)
        )
      )
    } catch (error) {
      return workspaceFailure(error)
    }
  })

  ipcMain.handle(IPC.workspace.readFile, async (event, input?: WorkspaceReadInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input !== 'object') return err('INVALID_INPUT', '工作区参数无效')
      return ok(
        await getWorkspaceService().readFile(
          validateWorkspaceId(input.workspaceId),
          validateWorkspaceRelativePath(input.path)
        )
      )
    } catch (error) {
      return workspaceFailure(error)
    }
  })

  ipcMain.handle(IPC.workspace.readMany, async (event, input?: WorkspaceReadManyInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input !== 'object' || !Array.isArray(input.paths)) {
        return err('INVALID_INPUT', '批量读取参数无效')
      }
      const paths = input.paths.map((path) => validateWorkspaceRelativePath(path))
      return ok(
        await getWorkspaceService().readMany(validateWorkspaceId(input.workspaceId), paths)
      )
    } catch (error) {
      return workspaceFailure(error)
    }
  })

  ipcMain.handle(IPC.workspace.searchText, async (event, input?: WorkspaceSearchInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input !== 'object' || typeof input.query !== 'string') {
        return err('INVALID_INPUT', '搜索参数无效')
      }
      return ok(
        await getWorkspaceService().searchText(
          validateWorkspaceId(input.workspaceId),
          input.query,
          validateWorkspaceRelativePath(input.path, true)
        )
      )
    } catch (error) {
      return workspaceFailure(error)
    }
  })
}
