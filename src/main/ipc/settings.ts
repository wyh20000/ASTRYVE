import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AgentProjectPreferences, AgentProjectSettings, BrowserPreferences, PersistedTheme } from '@shared/types'
import { DEFAULT_THEME_MODE, MODE_LEGACY_PRESET_ID, isThemeMode, normalizeHexColor, normalizeUiFontSize } from '@shared/themePreferences'
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
import { clearAgentAudit, listAgentAudit } from '../services/agent/taskRuntimeManager'

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
      const invalid = validateThemePayload(t)
      if (invalid) return err('INVALID_INPUT', invalid)
      // 兼容同时传入 mode 与 presetId 的情况：mode 优先，缺失时由 presetId 推导。
      const next: PersistedTheme = t
        ? {
            ...t,
            mode: isThemeMode(t.mode) ? t.mode : undefined,
            presetId:
              typeof t.presetId === 'string' ? t.presetId : undefined
          }
        : { mode: DEFAULT_THEME_MODE, overrides: {}, presetId: MODE_LEGACY_PRESET_ID[DEFAULT_THEME_MODE] }
      return ok(setThemeSettings(next))
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
  ipcMain.handle(IPC.settings.getAudit, (event) => {
    try {
      assertTrustedIpcSender(event)
      return ok(listAgentAudit())
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

/**
 * 校验主题写入载荷。
 * 返回中文错误描述表示不合法；返回 null 表示通过。
 * 颜色必须是合法 hex，字号必须落在允许范围内，所有字段长度受限。
 */
function validateThemePayload(t?: PersistedTheme): string | null {
  if (t == null) return null
  if (typeof t !== 'object') return '主题配置无效'
  if (t.mode != null && !isThemeMode(t.mode)) return '主题模式无效'
  if (t.presetId != null && (typeof t.presetId !== 'string' || t.presetId.length > 64)) {
    return '主题配置无效'
  }
  const overrides = t.overrides
  if (overrides != null && typeof overrides !== 'object') return '主题颜色无效'
  for (const key of ['bg', 'text', 'accent'] as const) {
    const value = overrides?.[key]
    if (value == null) continue
    if (typeof value !== 'string' || !normalizeHexColor(value)) return '主题颜色无效'
  }
  if (overrides?.uiFontSize != null) {
    const size = Number(overrides.uiFontSize)
    if (!Number.isFinite(size)) return '主题字号无效'
    if (normalizeUiFontSize(size) !== Math.round(size)) return '主题字号超出范围'
  }
  return null
}

function validateWorkspace(workspaceId: unknown): asserts workspaceId is string {
  if (
    typeof workspaceId !== 'string' ||
    !getWorkspaceGrants().some((workspace) => workspace.id === workspaceId)
  ) {
    throw new Error('项目工作区不存在或未授权')
  }
}
