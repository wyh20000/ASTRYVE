import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AgentProjectPreferences, AgentProjectSettings, BrowserPreferences, PersistedTheme } from '@shared/types'
import {
  getAgentProjectPreferences,
  getThemeSettings,
  getWorkspaceGrants,
  getBrowserPreferences,
  setAgentProjectPreferences,
  setThemeSettings,
  setBrowserPreferences
} from '../services/settings'
import { ok, err } from './result'
import { assertTrustedIpcSender } from './validation'
import {
  AGENT_EXECUTION_CAPABILITIES,
  defaultAgentProjectPreferences,
  refreshAgentExecutionCapabilities,
  validateAgentProjectPreferences
} from '../services/agent/projectPreferences'
import { clearAgentAudit } from '../services/agent/taskRuntimeManager'

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

  ipcMain.handle(IPC.settings.getAgentProject, async (event, workspaceId?: string) => {
    try {
      assertTrustedIpcSender(event)
      validateWorkspace(workspaceId)
      const capabilities = await refreshAgentExecutionCapabilities()
      const stored =
        getAgentProjectPreferences(workspaceId) ?? defaultAgentProjectPreferences(workspaceId)
      const imageStillExists = !stored.dockerImageId ||
        (capabilities.dockerImages ?? []).some((image) => image.imageId === stored.dockerImageId)
      const preferences = validateAgentProjectPreferences(
        imageStillExists ? stored : { ...stored, dockerImageId: undefined },
        new Set([workspaceId]), capabilities
      )
      return ok({
        preferences,
        capabilities
      } satisfies AgentProjectSettings)
    } catch (e) {
      return err('SET_ERR', e instanceof Error ? e.message : String(e))
    }
  })

  ipcMain.handle(
    IPC.settings.setAgentProject,
    (event, preferences?: AgentProjectPreferences) => {
      try {
        assertTrustedIpcSender(event)
        const authorized = new Set(getWorkspaceGrants().map((workspace) => workspace.id))
        const current = typeof preferences?.workspaceId === 'string'
          ? getAgentProjectPreferences(preferences.workspaceId) : undefined
        const validated = validateAgentProjectPreferences(preferences, authorized, AGENT_EXECUTION_CAPABILITIES, current)
        const saved = setAgentProjectPreferences(validated)
        return ok({
          preferences: saved,
          capabilities: AGENT_EXECUTION_CAPABILITIES
        } satisfies AgentProjectSettings)
      } catch (e) {
        return err('SET_ERR', e instanceof Error ? e.message : String(e))
      }
    }
  )

  ipcMain.handle(IPC.settings.clearAudit, (event) => {
    try {
      assertTrustedIpcSender(event)
      clearAgentAudit()
      return ok({ cleared: true })
    } catch (e) {
      return err('SET_ERR', e instanceof Error ? e.message : String(e))
    }
  })
  ipcMain.handle(IPC.settings.getBrowserPreferences, (event) => {
    try { assertTrustedIpcSender(event); return ok(getBrowserPreferences()) }
    catch (e) { return err('SET_ERR', e instanceof Error ? e.message : String(e)) }
  })
  ipcMain.handle(IPC.settings.setBrowserPreferences, (event, value?: BrowserPreferences) => {
    try {
      assertTrustedIpcSender(event)
      if (!value || typeof value !== 'object') return err('INVALID_INPUT', '浏览器设置无效')
      return ok(setBrowserPreferences(value))
    } catch (e) { return err('SET_ERR', e instanceof Error ? e.message : String(e)) }
  })
}

function validateWorkspace(workspaceId: unknown): asserts workspaceId is string {
  if (
    typeof workspaceId !== 'string' ||
    !getWorkspaceGrants().some((workspace) => workspace.id === workspaceId)
  ) {
    throw new Error('项目工作区不存在或未授权')
  }
}
