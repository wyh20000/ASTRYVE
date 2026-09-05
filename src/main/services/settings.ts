import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import type { AgentProjectPreferences, PersistedTheme, DbConfig } from '@shared/types'
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
}

const DEFAULTS: { theme: PersistedTheme; db: DbConfig } = {
  theme: { presetId: 'midnight', overrides: {} },
  db: { host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'ai_agent' }
}

let data: {
  theme: PersistedTheme
  db: DbConfig
  workspaces: WorkspaceGrant[]
  agentProjects: Record<string, AgentProjectPreferences>
} = {
  theme: { ...DEFAULTS.theme, overrides: { ...DEFAULTS.theme.overrides } },
  db: { ...DEFAULTS.db },
  workspaces: [],
  agentProjects: {}
}

function file(): string {
  return join(app.getPath('userData'), 'ai-agent-settings.json')
}

export function initSettings(): void {
  try {
    if (fs.existsSync(file())) {
      const raw = JSON.parse(fs.readFileSync(file(), 'utf-8')) as SettingsFile & Partial<PersistedTheme>
      // 兼容旧结构：顶层直接是主题
      if (raw.presetId) data.theme = { presetId: raw.presetId, overrides: raw.overrides ?? {} }
      if (raw.theme) data.theme = { ...data.theme, ...raw.theme }
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
  data.theme = { presetId: t.presetId ?? data.theme.presetId, overrides: t.overrides ?? {} }
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

function isAgentProjectPreferences(value: unknown): value is AgentProjectPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AgentProjectPreferences>
  return (
    typeof candidate.workspaceId === 'string' &&
    (PERMISSION_MODES as readonly unknown[]).includes(candidate.permissionMode) &&
    (EXECUTION_ENVIRONMENTS as readonly unknown[]).includes(candidate.executionEnvironment)
  )
}
