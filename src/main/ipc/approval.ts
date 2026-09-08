import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ApprovalUiResponse } from '@shared/types'
import { submitApprovalDecision } from '../services/agent/approvalDialog'
import { assertTrustedIpcSender } from './validation'
import { err, ok } from './result'

export function registerApprovalIpc(): void {
  ipcMain.handle(IPC.approval.respond, (event, input: ApprovalUiResponse) => {
    try {
      assertTrustedIpcSender(event)
      return submitApprovalDecision(input, event.sender.id)
        ? ok({ accepted: true })
        : err('APPROVAL_EXPIRED', '审批已失效或不属于当前窗口')
    } catch (error) {
      return err('INVALID_INPUT', String((error as Error)?.message ?? error))
    }
  })
}
