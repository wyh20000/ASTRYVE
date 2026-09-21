import { describe, expect, it } from 'vitest'
import { BROWSER_EXTENSION_ORIGIN } from './nativeMessagingConstants'
import { resolveNativeMessagingInvocation } from './nativeMessagingInvocation'

describe('Native Messaging invocation detection', () => {
  it('selects host mode only for the fixed extension origin', () => {
    expect(resolveNativeMessagingInvocation([BROWSER_EXTENSION_ORIGIN, '--parent-window=1']))
      .toEqual({ mode: 'native-host', origin: BROWSER_EXTENSION_ORIGIN })
    expect(resolveNativeMessagingInvocation(['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/']))
      .toEqual({ mode: 'rejected' })
    expect(resolveNativeMessagingInvocation(['--parent-window=1', BROWSER_EXTENSION_ORIGIN]))
      .toEqual({ mode: 'rejected' })
    expect(resolveNativeMessagingInvocation([BROWSER_EXTENSION_ORIGIN, '--unexpected']))
      .toEqual({ mode: 'rejected' })
  })

  it('keeps ordinary launches on the existing desktop path', () => {
    expect(resolveNativeMessagingInvocation(['--inspect=0'])).toEqual({ mode: 'desktop' })
  })
})
