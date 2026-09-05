import { BrowserWindow, dialog } from 'electron'
import type { ApprovalPrompt } from './toolAuthorization'
import type { TaskSnapshot } from '../../../shared/agent'

/** Only a native main-process dialog can produce this decision; no approval IPC is exposed. */
export function createApprovalDialog(getTask: (id: string) => TaskSnapshot | undefined): ApprovalPrompt {
  return async (request, signal) => {
    const task = getTask(request.taskId)
    const owner = task && BrowserWindow.getAllWindows().find((window) => window.webContents.id === task.ownerWebContentsId)
    if (!owner || owner.isDestroyed() || signal.aborted) return undefined
    const buttons = ['拒绝', '仅批准本次']
    if (request.scopeOptions.includes('task-prefix')) buttons.push('本任务批准相同命令和参数')
    const result = await dialog.showMessageBox(owner, {
      type: 'warning', title: 'AI Agent · 请求批准',
      message: request.summary,
      detail: `项目：${task.workspaceId}\n任务：${task.id}\n环境：${request.environment === 'docker' ? 'Docker 沙箱' : '本机执行'}\n操作：${request.operation}\n风险：${request.risk}\n\n目标（完整参数）：\n${request.normalizedTarget}\n\n拒绝后本次工具调用不会执行。`,
      buttons, defaultId: 0, cancelId: 0, noLink: true, signal
    })
    if (signal.aborted || owner.isDestroyed()) return undefined
    return result.response === 1 ? 'once' : result.response === 2 && buttons.length === 3 ? 'task-prefix' : undefined
  }
}
