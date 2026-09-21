import { BROWSER_EXTENSION_ORIGIN } from './nativeMessagingConstants'

export type NativeMessagingInvocation =
  | { mode: 'desktop' }
  | { mode: 'native-host'; origin: typeof BROWSER_EXTENSION_ORIGIN }
  | { mode: 'rejected' }

export function resolveNativeMessagingInvocation(args: readonly string[]): NativeMessagingInvocation {
  const containsExtensionOrigin = args.some((argument) =>
    argument.startsWith('chrome-extension://'))
  if (!containsExtensionOrigin) return { mode: 'desktop' }
  if (args[0] !== BROWSER_EXTENSION_ORIGIN) return { mode: 'rejected' }
  const trailing = args.slice(1)
  if (trailing.length > 1 ||
      (trailing.length === 1 && !/^--parent-window=\d+$/.test(trailing[0] ?? ''))) {
    return { mode: 'rejected' }
  }
  return { mode: 'native-host', origin: BROWSER_EXTENSION_ORIGIN }
}
