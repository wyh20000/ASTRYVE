import { describe, expect, it } from 'vitest'
import {
  CHROME_DEVTOOLS_MCP_PINNED_VERSION,
  officialChromeDevtoolsMcpArgs
} from './chromeDevtoolsMcpClient'

describe('official Chrome DevTools MCP configuration', () => {
  it('pins the reviewed Google release and uses only its documented flags', () => {
    expect(CHROME_DEVTOOLS_MCP_PINNED_VERSION).toBe('1.7.0')
    expect(officialChromeDevtoolsMcpArgs('official-entry.js')).toEqual([
      'official-entry.js',
      '--auto-connect',
      '--experimental-page-id-routing=true',
      '--no-usage-statistics',
      '--no-performance-crux',
      '--redact-network-headers',
      '--category-emulation=false',
      '--category-performance=false',
      '--experimental-structured-content=true'
    ])
  })
})
