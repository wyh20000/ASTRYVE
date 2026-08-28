import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ModelConfig } from '@shared/types'
import { getModelConfig, setModelConfig } from '../services/modelConfig'
import { testChat } from '../services/modelProvider'
import { ok, err } from './result'

export function registerModelIpc(): void {
  ipcMain.handle(IPC.model.getConfig, () => {
    try {
      return ok(getModelConfig())
    } catch (e) {
      return err('CFG_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.model.setConfig, (_e, cfg?: Partial<ModelConfig>) => {
    try {
      return ok(setModelConfig(cfg ?? {}))
    } catch (e) {
      return err('CFG_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.model.test, async () => {
    try {
      const r = await testChat(getModelConfig())
      return ok(r)
    } catch (e) {
      return err('TEST_ERR', String(e))
    }
  })
}