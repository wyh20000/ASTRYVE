import { describe, expect, it } from 'vitest'
import {
  createSecureWebPreferences,
  isAllowedExternalUrl,
  isAllowedRendererNavigation
} from './windowSecurity'

describe('renderer window security policy', () => {
  it('always creates an isolated sandboxed renderer without Node integration', () => {
    expect(createSecureWebPreferences('C:/app/preload.js')).toMatchObject({
      preload: 'C:/app/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })
  })

  it('opens only credential-free HTTPS links outside the app', () => {
    expect(isAllowedExternalUrl('https://example.com/docs')).toBe(true)
    expect(isAllowedExternalUrl('https://user:secret@example.com/')).toBe(false)
    expect(isAllowedExternalUrl('http://example.com/')).toBe(false)
    expect(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
  })

  it('prevents the renderer from navigating away from its current page', () => {
    expect(isAllowedRendererNavigation('https://localhost:5173/', 'https://localhost:5173/')).toBe(true)
    expect(isAllowedRendererNavigation('file:///C:/app/index.html', 'file:///C:/other/index.html')).toBe(false)
    expect(isAllowedRendererNavigation('https://localhost:5173/', 'https://evil.example/')).toBe(false)
  })
})
