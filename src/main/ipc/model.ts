import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { ModelConfig, ModelPreset, ReasoningEffort } from '@shared/types'
import {
  getModelConfig,
  setModelConfig,
  setActivePreset,
  setReasoningEffort,
  getActivePreset,
  toPublicModelConfig
} from '../services/modelConfig'
import { testChat } from '../services/modelProvider'
import { ok, err } from './result'
import {
  assertTrustedIpcSender,
  validateModelConfigPatch,
  validateSessionId,
  validationErrorMessage
} from './validation'

export function registerModelIpc(): void {
  ipcMain.handle(IPC.model.getConfig, (event) => {
    try {
      assertTrustedIpcSender(event)
      return ok(toPublicModelConfig(getModelConfig()))
    } catch (e) {
      return err('CFG_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.model.setConfig, (event, cfg?: Partial<ModelConfig>) => {
    try {
      assertTrustedIpcSender(event)
      return ok(toPublicModelConfig(setModelConfig(validateModelConfigPatch(cfg ?? {}))))
    } catch (e) {
      return err('CFG_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.model.setActive, (event, id: string) => {
    try {
      assertTrustedIpcSender(event)
      validateSessionId(id)
      return ok(toPublicModelConfig(setActivePreset(id)))
    } catch (e) {
      return err('CFG_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.model.setReasoning, (event, effort: ReasoningEffort) => {
    try {
      assertTrustedIpcSender(event)
      if (effort !== 'low' && effort !== 'medium' && effort !== 'high') {
        return err('INVALID_INPUT', '推理等级无效')
      }
      return ok(toPublicModelConfig(setReasoningEffort(effort)))
    } catch (e) {
      return err('CFG_ERR', String(e))
    }
  })

  ipcMain.handle(IPC.model.test, async (event, preset?: ModelPreset) => {
    try {
      assertTrustedIpcSender(event)
      if (preset) validateModelConfigPatch({ presets: [preset] })
      const active = getActivePreset()
      const stored = preset ? getModelConfig().presets.find((item) => item.id === preset.id) : null
      const p = preset
        ? { ...preset, apiKey: preset.apiKey || stored?.apiKey || '' }
        : active
      if (!p) return ok({ success: false, message: '无可用模型' })
      const r = await testChat(p)
      return ok(r)
    } catch (e) {
      return err('TEST_ERR', String(e))
    }
  })
}
