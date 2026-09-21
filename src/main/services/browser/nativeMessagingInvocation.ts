import { BROWSER_EXTENSION_ORIGIN } from './nativeMessagingConstants'

export type NativeMessagingInvocation =
  | { mode: 'desktop' }
  | { mode: 'native-host'; origin: typeof BROWSER_EXTENSION_ORIGIN }
  | { mode: 'rejected' }

export function resolveNativeMessagingInvocation(args: readonly string[]): NativeMessagingInvocation {
  const origins = args.filter((argument) => argument.startsWith('chrome-extension://'))
  if (!origins.length) return { mode: 'desktop' }
  if (origins.length === 1 && origins[0] === BROWSER_EXTENSION_ORIGIN) {
    return { mode: 'native-host', origin: BROWSER_EXTENSION_ORIGIN }
  }
  return { mode: 'rejected' }
}
