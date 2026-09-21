import { app, dialog } from 'electron'
import { join } from 'node:path'
import { BrowserPairingVault } from './browserPairingVault'
import { BROWSER_EXTENSION_ORIGIN } from './nativeMessagingConstants'
import { encodeNativeMessageFrame, NativeMessageFrameDecoder } from './nativeMessagingFrames'
import { NativePairingHost } from './nativePairingHost'
import type { HostNativeMessage } from './nativeMessagingProtocol'

export async function runNativeMessagingHost(origin: string): Promise<void> {
  if (origin !== BROWSER_EXTENSION_ORIGIN) throw new Error('Native Messaging origin rejected')
  app.setPath('userData', join(app.getPath('appData'), 'ai-agent'))
  app.setName('ASTRYVE')
  await app.whenReady()

  const vault = new BrowserPairingVault(join(app.getPath('userData'), 'browser-native'))
  const host = new NativePairingHost({
    vault,
    now: Date.now,
    send: writeMessage,
    confirmPairing: async ({ code, extensionVersion }) => {
      const result = await dialog.showMessageBox({
        type: 'question',
        title: 'ASTRYVE 浏览器安全配对',
        message: `配对码 ${code}`,
        detail: `Chrome 扩展 ${extensionVersion} 正在请求连接。仅当浏览器中显示相同号码时确认。`,
        buttons: ['确认配对', '拒绝'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })
      return result.response === 0
    }
  })
  const decoder = new NativeMessageFrameDecoder()
  let queue = Promise.resolve()
  let fatalStarted = false
  const cleanupTimer = setInterval(() => host.cleanupExpired(), 30_000)
  cleanupTimer.unref()

  const fatal = (): void => {
    if (fatalStarted) return
    fatalStarted = true
    clearInterval(cleanupTimer)
    process.stdin.pause()
    process.stderr.write('[astryve-native-host] protocol failure\n')
    const error: HostNativeMessage = {
      type: 'host.error',
      protocolVersion: 1,
      code: 'INVALID_MESSAGE',
      message: '本地通信消息无效'
    }
    try {
      process.stdout.write(encodeNativeMessageFrame(error), () => app.exit(1))
    } catch {
      app.exit(1)
    }
  }

  process.stdout.on('error', () => app.exit(1))
  process.stdin.on('data', (chunk: Buffer) => {
    if (fatalStarted) return
    try {
      const messages = decoder.push(chunk)
      for (const message of messages) {
        queue = queue.then(() => host.handleMessage(message))
      }
      void queue.catch(fatal)
    } catch {
      fatal()
    }
  })
  process.stdin.on('error', fatal)
  process.stdin.on('end', () => {
    clearInterval(cleanupTimer)
    queue = queue.then(() => decoder.finish())
    void queue.then(() => app.quit()).catch(fatal)
  })
  process.stdin.resume()
}

function writeMessage(message: HostNativeMessage): void {
  process.stdout.write(encodeNativeMessageFrame(message))
}
