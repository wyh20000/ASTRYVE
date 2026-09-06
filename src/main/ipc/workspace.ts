import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ActivateWorkspaceInput,
  WorkspaceListInput,
  WorkspaceReadInput,
  WorkspaceSaveInput,
  WorkspaceReadManyInput,
  WorkspaceFileSearchInput,
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
import { cancelTasksForSession } from '../services/agent/taskRuntimeManager'
import { getPatchWorkspaceService, getTaskRuntime } from '../services/agent/taskRuntimeManager'
import { PatchWorkspaceError } from '../services/agent/patchWorkspaceService'
import type { RejectPatchFileInput } from '@shared/types'
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
  if (error instanceof PatchWorkspaceError) return err(error.code, error.message)
  if (error instanceof InputValidationError) {
    return err('INVALID_INPUT', validationErrorMessage(error))
  }
  console.warn('[workspace] operation failed:', error instanceof Error ? error.message : String(error))
  return err('WORKSPACE_ERROR', '工作区操作失败，请确认项目仍然可访问')
}

export function registerWorkspaceIpc(): void {
  onSessionWorkspaceSwitched((sessionId) => {
    cancelGeneration(sessionId, 'workspace_switched')
    cancelTasksForSession(sessionId, 'workspace_switched')
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
        (await getWorkspaceService().listDirectory(
          validateWorkspaceId(input.workspaceId),
          validateWorkspaceRelativePath(input.path, true), 0, 500
        )).entries
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

  ipcMain.handle(IPC.workspace.saveFile, async (event, input?: WorkspaceSaveInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input !== 'object' || typeof input.content !== 'string' || typeof input.expectedHash !== 'string') {
        return err('INVALID_INPUT', '保存文件参数无效')
      }
      return ok(await getWorkspaceService().saveFile(
        validateWorkspaceId(input.workspaceId),
        validateWorkspaceRelativePath(input.path),
        input.content,
        input.expectedHash
      ))
    } catch (error) {
      return workspaceFailure(error)
    }
  })

  ipcMain.handle(IPC.workspace.findFiles, async (event, input?: WorkspaceFileSearchInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input !== 'object' || typeof input.query !== 'string') {
        return err('INVALID_INPUT', '文件搜索参数无效')
      }
      return ok(await getWorkspaceService().findFiles(
        validateWorkspaceId(input.workspaceId),
        input.query,
        validateWorkspaceRelativePath(input.path, true)
      ))
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

  ipcMain.handle(IPC.workspace.rejectPatchFile, async (event, input?: RejectPatchFileInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input !== 'object' || typeof input.taskId !== 'string' ||
          typeof input.patchHash !== 'string' || typeof input.path !== 'string') {
        return err('INVALID_INPUT', '补丁拒绝参数无效')
      }
      const task = getTaskRuntime().getTaskSnapshot(input.taskId)
      if (!task || task.ownerWebContentsId !== event.sender.id) return err('NOT_FOUND', '任务不存在或不属于当前窗口')
      const manifest = getPatchWorkspaceService().rejectFile(
        task.id, task.workspaceId, input.patchHash, validateWorkspaceRelativePath(input.path)
      )
      const contents = new Map(getPatchWorkspaceService().previewContents(task.id)
        .map((content) => [content.path, content]))
      return ok({
        kind: 'diff' as const, taskId: task.id, patchHash: manifest.patchHash,
        files: manifest.files.map(({ path, previousPath, status, linesAdded, linesDeleted, diff }) => ({
          path, previousPath, status, linesAdded, linesDeleted, diff, ...contents.get(path)
        })),
        linesAdded: manifest.linesAdded, linesDeleted: manifest.linesDeleted
      })
    } catch (error) {
      return workspaceFailure(error)
    }
  })
}
