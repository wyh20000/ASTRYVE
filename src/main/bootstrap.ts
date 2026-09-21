import { resolveNativeMessagingInvocation } from './services/browser/nativeMessagingInvocation'

const invocation = resolveNativeMessagingInvocation(process.argv.slice(1))

if (invocation.mode === 'desktop') {
  void import('./index')
} else if (invocation.mode === 'native-host') {
  void import('./services/browser/nativeMessagingHostEntry')
    .then(({ runNativeMessagingHost }) => runNativeMessagingHost(invocation.origin))
    .catch(() => {
      process.stderr.write('[astryve-native-host] startup failure\n')
      process.exitCode = 1
    })
} else {
  process.stderr.write('[astryve-native-host] rejected extension origin\n')
  process.exitCode = 1
}
