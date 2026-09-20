import { describe, expect, it } from 'vitest'
import { PLUGIN_UI_CSP, pluginUiWebPreferences, wrapPluginUiHtml } from './pluginUiSecurity'

describe('isolated plugin UI policy', () => {
  it('uses a dedicated sandboxed renderer without Node integration', () => {
    expect(pluginUiWebPreferences('pluginUi.js', 'plugin-ui-test')).toMatchObject({
      preload: 'pluginUi.js', partition: 'plugin-ui-test', sandbox: true,
      contextIsolation: true, nodeIntegration: false, webSecurity: true
    })
  })

  it('places the restrictive CSP before plugin-controlled HTML', () => {
    const html = wrapPluginUiHtml('<script>window.executed = true</script>')
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('window.executed'))
    for (const rule of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'",
      "worker-src 'none'", "form-action 'none'", "base-uri 'none'"]) {
      expect(PLUGIN_UI_CSP).toContain(rule)
    }
  })
})
