export const BROWSER_NATIVE_HOST_NAME = 'com.astryve.browser' as const
export const BROWSER_EXTENSION_ID = 'lcjaalloempdgnhjjcpnckiniccpnacm' as const
export const BROWSER_EXTENSION_ORIGIN =
  `chrome-extension://${BROWSER_EXTENSION_ID}/` as const
export const NATIVE_MESSAGING_PROTOCOL_VERSION = 1 as const
export const NATIVE_MESSAGING_MESSAGE_LIMIT_BYTES = 200 * 1024
export const PAIRING_CHALLENGE_TTL_MS = 2 * 60 * 1000
export const BROWSER_SESSION_TTL_MS = 15 * 60 * 1000
