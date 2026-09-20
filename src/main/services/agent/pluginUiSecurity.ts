import type { WebPreferences } from 'electron'

export const PLUGIN_UI_CSP = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
  'img-src data:', "connect-src 'none'", "font-src 'none'", "media-src 'none'",
  "frame-src 'none'", "worker-src 'none'", "object-src 'none'",
  "form-action 'none'", "base-uri 'none'"
].join('; ')

export function pluginUiWebPreferences(preload: string, partition: string): WebPreferences {
  return {
    preload, partition, sandbox: true, contextIsolation: true,
    nodeIntegration: false, webSecurity: true
  }
}

export function wrapPluginUiHtml(content: string): string {
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
    PLUGIN_UI_CSP + '"></head><body>' + content + '</body></html>'
}
