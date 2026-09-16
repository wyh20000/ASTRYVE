import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import type { AgentProjectPreferences, PersistedTheme, DbConfig, BrowserPreferences, PluginPreferences } from '@shared/types'
import {
  DEFAULT_THEME_MODE,
  MODE_LEGACY_PRESET_ID,
  isCurrentThemeSchema,
  resolveThemeSettings
} from '@shared/themePreferences'
import {
  EXECUTION_ENVIRONMENTS,
  PERMISSION_MODES,
  type WorkspaceGrant
} from '@shared/agent'

interface SettingsFile {
  theme?: PersistedTheme
  db?: DbConfig
  workspaces?: WorkspaceGrant[]
  agentProjects?: Record<string, AgentProjectPreferences>
  disabledSkills?: string[]
  disabledPlugins?: string[]
  browser?: BrowserPreferences
  plugins?: PluginPreferences
}

const DEFAULTS: { theme: PersistedTheme; db: DbConfig } = {
  theme: {
    version: 2,
    mode: DEFAULT_THEME_MODE,
    overrides: {},
    presetId: MODE_LEGACY_PRESET_ID[DEFAULT_THEME_MODE]
  },
  db: { host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'ai_agent' }
}

let data: {
  theme: PersistedTheme
  db: DbConfig
  workspaces: WorkspaceGrant[]
  agentProjects: Record<string, AgentProjectPreferences>
  disabledSkills: string[]
  disabledPlugins: string[]
  browser: BrowserPreferences
  plugins: PluginPreferences
} = {
  theme: { ...DEFAULTS.theme, overrides: { ...DEFAULTS.theme.overrides } },
  db: { ...DEFAULTS.db },
  workspaces: [],
  agentProjects: {},
  disabledSkills: [],
  disabledPlugins: [],
  browser: { allowAllSites: false, allowedOrigins: [], blockedOrigins: [] },
  plugins: { autoUpdate: false }
}

function file(): string {
  return join(app.getPath('userData'), 'ai-agent-settings.json')
}

export function initSettings(): void {
  try {
    if (fs.existsSync(file())) {
      const raw = JSON.parse(fs.readFileSync(file(), 'utf-8')) as SettingsFile & Partial<PersistedTheme>
      // 主题：兼容「顶层直接是主题」「theme 包裹」「新版 mode」三种历史形态。
      // resolveThemeSettings 会把旧 presetId 迁移成 mode + 覆盖，且永不抛错。
      const themeSource = raw.theme ?? (raw.presetId ? raw : undefined)
      let themeMigrated = false
      if (themeSource) {
        data.theme = resolveThemeSettings(themeSource)
        themeMigrated = !isCurrentThemeSchema(themeSource)
      }
      if (raw.db) data.db = { ...data.db, ...raw.db }
      if (Array.isArray(raw.workspaces)) data.workspaces = raw.workspaces
      if (raw.agentProjects && typeof raw.agentProjects === 'object') {
        data.agentProjects = Object.fromEntries(
          Object.entries(raw.agentProjects).filter(
            ([workspaceId, value]) =>
              isAgentProjectPreferences(value) && value.workspaceId === workspaceId
          )
        )
      }
      if (Array.isArray(raw.disabledSkills)) {
        data.disabledSkills = raw.disabledSkills.filter((id): id is string =>
          typeof id === 'string' && /^[a-z]+:[a-f0-9]{12}:[a-z0-9_-]{1,64}$/.test(id)
        ).slice(0, 500)
      }
      if (Array.isArray(raw.disabledPlugins)) {
        data.disabledPlugins = raw.disabledPlugins.filter((id): id is string =>
          typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)
        ).slice(0, 500)
      }
      if (raw.browser) data.browser = sanitizeBrowserPreferences(raw.browser)
      if (raw.plugins && typeof raw.plugins === 'object') data.plugins = { autoUpdate: raw.plugins.autoUpdate === true }
      // 旧结构迁移成功后立即写回，后续启动直接读取新结构
      if (themeMigrated) persist()
    }
  } catch (e) {
    console.warn('[settings] load failed:', e)
  }
}

function persist(strict = false): void {
  const target = file()
  const temp = `${target}.${process.pid}.tmp`
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
    fs.renameSync(temp, target)
  } catch (e) {
    try {
      fs.rmSync(temp, { force: true })
    } catch {
      // best effort cleanup
    }
    console.warn('[settings] save failed:', e)
    if (strict) throw new Error('项目设置保存失败，请重试')
  }
}

export function getThemeSettings(): PersistedTheme {
  return data.theme
}

export function setThemeSettings(t: PersistedTheme): PersistedTheme {
  // 统一走 resolveThemeSettings：清洗覆盖、补齐 version 并镜像 presetId，
  // 因此即使渲染进程传入旧结构也能安全落盘。
  const merged = { ...data.theme, ...t }
  data.theme = resolveThemeSettings(merged)
  persist()
  return data.theme
}

export function getDbSettings(): DbConfig {
  return data.db
}

export function setDbSettings(d: DbConfig): DbConfig {
  data.db = { ...data.db, ...d }
  persist()
  return data.db
}

export function getWorkspaceGrants(): WorkspaceGrant[] {
  return data.workspaces.map((grant) => ({ ...grant }))
}

export function setWorkspaceGrants(grants: WorkspaceGrant[]): void {
  data.workspaces = grants.map((grant) => ({ ...grant }))
  persist()
}

export function getAgentProjectPreferences(workspaceId: string): AgentProjectPreferences | undefined {
  const preferences = data.agentProjects[workspaceId]
  return preferences ? { ...preferences } : undefined
}

export function setAgentProjectPreferences(
  preferences: AgentProjectPreferences
): AgentProjectPreferences {
  const previous = data.agentProjects[preferences.workspaceId]
  data.agentProjects[preferences.workspaceId] = { ...preferences }
  try {
    persist(true)
  } catch (error) {
    if (previous) data.agentProjects[preferences.workspaceId] = previous
    else delete data.agentProjects[preferences.workspaceId]
    throw error
  }
  return { ...preferences }
}

export function getDisabledSkillIds(): Set<string> {
  return new Set(data.disabledSkills)
}

export function setSkillEnabled(id: string, enabled: boolean): void {
  if (!/^[a-z]+:[a-f0-9]{12}:[a-z0-9_-]{1,64}$/.test(id)) throw new Error('Skill 标识无效')
  const previous = data.disabledSkills
  const disabled = new Set(previous)
  if (enabled) disabled.delete(id); else disabled.add(id)
  data.disabledSkills = [...disabled].slice(0, 500)
  try { persist(true) } catch (error) { data.disabledSkills = previous; throw error }
}

export function getDisabledPluginIds(): Set<string> {
  return new Set(data.disabledPlugins)
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error('插件标识无效')
  const previous = data.disabledPlugins
  const disabled = new Set(previous)
  if (enabled) disabled.delete(id)
  else {
    if (!disabled.has(id) && disabled.size >= 500) throw new Error('插件禁用列表已满，无法安全安装更多插件')
    disabled.add(id)
  }
  data.disabledPlugins = [...disabled]
  try { persist(true) } catch (error) { data.disabledPlugins = previous; throw error }
}

export function getPluginPreferences(): PluginPreferences { return { ...data.plugins } }
export function setPluginPreferences(value: PluginPreferences): PluginPreferences {
  const previous = data.plugins
  data.plugins = { autoUpdate: value?.autoUpdate === true }
  try { persist(true) } catch (error) { data.plugins = previous; throw error }
  return getPluginPreferences()
}

export function getBrowserPreferences(): BrowserPreferences { return { ...data.browser, allowedOrigins: [...data.browser.allowedOrigins], blockedOrigins: [...data.browser.blockedOrigins] } }
export function setBrowserPreferences(value: BrowserPreferences): BrowserPreferences {
  const previous = data.browser
  data.browser = sanitizeBrowserPreferences(value)
  try { persist(true) } catch (error) { data.browser = previous; throw error }
  return getBrowserPreferences()
}

function sanitizeBrowserPreferences(value: BrowserPreferences): BrowserPreferences {
  const origins = (items: unknown): string[] => {
    if (!Array.isArray(items)) return []
    return [...new Set(items.slice(0, 500).map((item) => {
      if (typeof item !== 'string') throw new Error('网站地址无效')
      const url = new URL(item)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('网站地址无效')
      return url.origin.toLowerCase()
    }))]
  }
  return { allowAllSites: value?.allowAllSites === true, allowedOrigins: origins(value?.allowedOrigins), blockedOrigins: origins(value?.blockedOrigins) }
}

function isAgentProjectPreferences(value: unknown): value is AgentProjectPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AgentProjectPreferences>
  return (
    typeof candidate.workspaceId === 'string' &&
    (PERMISSION_MODES as readonly unknown[]).includes(candidate.permissionMode) &&
    (EXECUTION_ENVIRONMENTS as readonly unknown[]).includes(candidate.executionEnvironment)
    && (candidate.dockerImageId === undefined ||
      (typeof candidate.dockerImageId === 'string' && /^sha256:[a-f0-9]{64}$/i.test(candidate.dockerImageId)))
  )
}
