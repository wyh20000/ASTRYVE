import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ModelConfig, ModelPreset, ReasoningEffort } from '@shared/types'
import {
  getModelConfig,
  setModelConfig,
  setActivePreset,
  setReasoningEffort,
  getActivePreset
} from '../services/modelConfig'
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

  ipcMain.handle(IPC.model.setActive, (_e, id: string) => {
    try {
      return ok(setActivePreset(id))
    } catch (e) {
      return err('CFG_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.model.setReasoning, (_e, effort: ReasoningEffort) => {
    try {
      return ok(setReasoningEffort(effort))
    } catch (e) {
      return err('CFG_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.model.test, async (_e, preset?: ModelPreset) => {
    try {
      const p = preset ?? getActivePreset()
      if (!p) return ok({ success: false, message: '无可用模型' })
      const r = await testChat(p)
      return ok(r)
    } catch (e) {
      return err('TEST_ERR', String(e))
    }
  })
}
