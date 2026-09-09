import type { WebPreferences } from 'electron'

export function createSecureWebPreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
}

export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

export function isAllowedRendererNavigation(currentUrl: string, navigationUrl: string): boolean {
  return currentUrl === navigationUrl
}
