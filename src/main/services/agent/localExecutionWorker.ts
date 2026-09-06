import { runLocalCommand, validateLocalCommand } from './localCommand'
import { runWindowsJob } from './windowsJob'
import { join } from 'node:path'

// This module is a separate utility-process build entry, never imported by renderer/main.
const port = process.parentPort
const controller = new AbortController()
let started = false
let lastHeartbeat = Date.now()
const watchdog = setInterval(() => {
  if (Date.now() - lastHeartbeat > 5000) controller.abort()
}, 1000)
watchdog.unref()
port.on('message', (event: { data: unknown }) => {
  const message = event.data as { type?: string; command?: unknown } | null
  if (message?.type === 'heartbeat') { lastHeartbeat = Date.now(); return }
  if (message?.type === 'stop') { controller.abort(); return }
  if (started || message?.type !== 'run') return
  started = true
  void (async () => {
    try {
      validateLocalCommand(message.command)
      const output = (stream: 'stdout' | 'stderr', text: string) => {
        port.postMessage({ type: 'output', stream, text })
      }
      const started = (pid: number) => port.postMessage({ type: 'started', pid })
      const helper = join(__dirname, '../native/JobHost.exe').replace('app.asar', 'app.asar.unpacked')
      const result = process.platform === 'win32'
        ? await runWindowsJob(helper, message.command, controller.signal, output, undefined, started)
        : await runLocalCommand(message.command, controller.signal, output, started)
      port.postMessage({ type: 'result', result })
    } catch (error) {
      port.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'COMMAND_FAILED' })
    }
  })()
})
