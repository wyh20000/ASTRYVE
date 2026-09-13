import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { registerSessionIpc } from './session'
import { registerMessageIpc } from './message'
import { registerWindowIpc } from './window'
import { registerModelIpc } from './model'
import { registerSettingsIpc } from './settings'
import { registerWorkspaceIpc } from './workspace'
import { registerTerminalIpc } from './terminal'
import { registerSkillsIpc } from './skills'
import { registerApprovalIpc } from './approval'
import { registerPluginsIpc } from './plugins'
import { ok, err } from './result'
import { assertTrustedIpcSender } from './validation'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.app.ping, (event) => {
    try {
      assertTrustedIpcSender(event)
      return ok('pong')
    } catch (e) {
      return err('ERR', String(e))
    }
  })

  registerSessionIpc()
  registerMessageIpc()
  registerWindowIpc()
  registerModelIpc()
  registerSettingsIpc()
  registerWorkspaceIpc()
  registerTerminalIpc()
  registerSkillsIpc()
  registerPluginsIpc()
  registerApprovalIpc()
}
