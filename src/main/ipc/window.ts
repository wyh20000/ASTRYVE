import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { ok, err } from './result'
import { FIRST_PAINT_BACKGROUND, FIRST_PAINT_SYMBOL } from '@shared/themePaint'
import { assertTrustedIpcSender } from './validation'

export function registerWindowIpc(): void {
  ipcMain.handle(IPC.window.setTitleBarOverlay, (event, opts?: { color: string; symbolColor: string }) => {
    try {
      assertTrustedIpcSender(event)
      if (
        opts &&
        (!/^#[0-9a-f]{6}$/i.test(opts.color) || !/^#[0-9a-f]{6}$/i.test(opts.symbolColor))
      ) {
        return err('INVALID_INPUT', '标题栏颜色无效')
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && process.platform === 'win32') {
        win.setTitleBarOverlay({
          color: opts?.color ?? FIRST_PAINT_BACKGROUND,
          symbolColor: opts?.symbolColor ?? FIRST_PAINT_SYMBOL,
          height: 32
        })
      }
      return ok(true)
    } catch (e) {
      return err('WIN_ERR', String(e))
    }
  })
}
