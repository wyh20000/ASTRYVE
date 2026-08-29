import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import type { PersistedTheme } from '@shared/types'

let theme: PersistedTheme = { presetId: 'midnight', overrides: {} }

function file(): string {
  return join(app.getPath('userData'), 'ai-agent-settings.json')
}

export function initSettings(): void {
  try {
    if (fs.existsSync(file())) {
      const saved = JSON.parse(fs.readFileSync(file(), 'utf-8')) as Partial<PersistedTheme>
      if (saved.presetId) theme.presetId = saved.presetId
      if (saved.overrides) theme.overrides = saved.overrides ?? {}
    }
  } catch (e) {
    console.warn('[settings] load failed:', e)
  }
}

export function getThemeSettings(): PersistedTheme {
  return theme
}

export function setThemeSettings(t: PersistedTheme): PersistedTheme {
  theme = { presetId: t.presetId ?? theme.presetId, overrides: t.overrides ?? {} }
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify(theme, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[settings] save failed:', e)
  }
  return theme
}
