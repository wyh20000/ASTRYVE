import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AgentProjectPreferences, AgentProjectSettings, PersistedTheme } from '@shared/types'
import {
  getAgentProjectPreferences,
  getThemeSettings,
  getWorkspaceGrants,
  setAgentProjectPreferences,
  setThemeSettings
} from '../services/settings'
import { ok, err } from './result'
import { assertTrustedIpcSender } from './validation'
import {
  AGENT_EXECUTION_CAPABILITIES,
  defaultAgentProjectPreferences,
  validateAgentProjectPreferences
} from '../services/agent/projectPreferences'

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

  ipcMain.handle(IPC.settings.getAgentProject, (event, workspaceId?: string) => {
    try {
      assertTrustedIpcSender(event)
      validateWorkspace(workspaceId)
      const preferences =
        getAgentProjectPreferences(workspaceId) ?? defaultAgentProjectPreferences(workspaceId)
      return ok({
        preferences,
        capabilities: AGENT_EXECUTION_CAPABILITIES
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
}

function validateWorkspace(workspaceId: unknown): asserts workspaceId is string {
  if (
    typeof workspaceId !== 'string' ||
    !getWorkspaceGrants().some((workspace) => workspace.id === workspaceId)
  ) {
    throw new Error('项目工作区不存在或未授权')
  }
}
