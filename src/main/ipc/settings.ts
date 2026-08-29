import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { PersistedTheme } from '@shared/types'
import { getThemeSettings, setThemeSettings } from '../services/settings'
import { ok, err } from './result'

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settings.getTheme, () => {
    try {
      return ok(getThemeSettings())
    } catch (e) {
      return err('SET_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.settings.setTheme, (_e, t?: PersistedTheme) => {
    try {
      return ok(setThemeSettings(t ?? { presetId: 'midnight', overrides: {} }))
    } catch (e) {
      return err('SET_ERR', String(e))
    }
  })
}
