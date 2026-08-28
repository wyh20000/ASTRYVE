import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { ok, err } from './result'

export function registerWindowIpc(): void {
  ipcMain.handle(IPC.window.setTitleBarOverlay, (event, opts?: { color: string; symbolColor: string }) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && process.platform === 'win32') {
        win.setTitleBarOverlay({ color: opts?.color ?? '#0a0e17', symbolColor: opts?.symbolColor ?? '#a7b0c0', height: 32 })
      }
      return ok(true)
    } catch (e) {
      return err('WIN_ERR', String(e))
    }
  })
}
