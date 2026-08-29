import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import type { PersistedTheme, DbConfig } from '@shared/types'

interface SettingsFile {
  theme?: PersistedTheme
  db?: DbConfig
}

const DEFAULTS: { theme: PersistedTheme; db: DbConfig } = {
  theme: { presetId: 'midnight', overrides: {} },
  db: { host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'ai_agent' }
}

let data: { theme: PersistedTheme; db: DbConfig } = {
  theme: { ...DEFAULTS.theme, overrides: { ...DEFAULTS.theme.overrides } },
  db: { ...DEFAULTS.db }
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
    }
  } catch (e) {
    console.warn('[settings] load failed:', e)
  }
}

function persist(): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[settings] save failed:', e)
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
