import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { PersistedTheme } from '@shared/types'
import { getThemeSettings, setThemeSettings } from '../services/settings'
import { ok, err } from './result'
import { assertTrustedIpcSender } from './validation'

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settings.getTheme, (event) => {
    try {
      assertTrustedIpcSender(event)
      return ok(getThemeSettings())
    } catch (e) {
      return err('SET_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.settings.setTheme, (event, t?: PersistedTheme) => {
    try {
      assertTrustedIpcSender(event)
      if (t && (typeof t.presetId !== 'string' || t.presetId.length > 64)) {
        return err('INVALID_INPUT', '主题配置无效')
      }
      for (const color of Object.values(t?.overrides ?? {})) {
        if (color != null && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) {
          return err('INVALID_INPUT', '主题颜色无效')
        }
      }
      return ok(setThemeSettings(t ?? { presetId: 'midnight', overrides: {} }))
    } catch (e) {
      return err('SET_ERR', String(e))
    }
  })
}
