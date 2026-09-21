import { utilityProcess } from 'electron'
import { join } from 'node:path'
import type { ExecutionResult } from '../../../shared/agent'
import { validateLocalCommand, type LocalCommand, type CommandOutput } from './localCommand'

/** Main-process transport; task policy and path verification precede this boundary. */
export function executeInUtilityProcess(
  command: LocalCommand,
  signal: AbortSignal,
  output: CommandOutput,
  onStarted?: (pid: number) => void
): Promise<ExecutionResult> {
  validateLocalCommand(command)
  if (signal.aborted) return Promise.reject(new Error('COMMAND_CANCELLED'))
  return new Promise((resolve, reject) => {
    const worker = utilityProcess.fork(join(__dirname, 'localExecutionWorker.js'), [], {
      serviceName: 'ASTRYVE command worker', env: { ...command.env }, stdio: 'ignore'
    })
    let settled = false
    let cancellation = false
    let cancellationDeadline: ReturnType<typeof setTimeout> | undefined
    const heartbeat = setInterval(() => {
      if (!settled) worker.postMessage({ type: 'heartbeat' })
    }, 1000)
    const finish = (error?: Error, result?: ExecutionResult) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (cancellationDeadline) clearTimeout(cancellationDeadline)
      clearInterval(heartbeat)
      signal.removeEventListener('abort', abort)
      worker.kill()
      if (error) reject(error)
      else resolve(result!)
    }
    const abort = () => {
      cancellation = true
      worker.postMessage({ type: 'stop' })
      cancellationDeadline ??= setTimeout(() => finish(new Error('COMMAND_CANCELLED')), 2000)
    }
    const deadline = setTimeout(() => finish(new Error('WORKER_TIMEOUT')), command.timeoutMs + 5000)
    signal.addEventListener('abort', abort, { once: true })
    worker.once('spawn', () => {
      if (signal.aborted) { finish(new Error('COMMAND_CANCELLED')); return }
      worker.postMessage({ type: 'run', command })
    })
    worker.once('exit', () => finish(new Error(cancellation ? 'COMMAND_CANCELLED' : 'WORKER_EXITED')))
    worker.on('message', (message) => {
      if (settled) return
      if (message?.type === 'output' && typeof message.text === 'string' &&
        (message.stream === 'stdout' || message.stream === 'stderr')) {
        output(message.stream, message.text)
      } else if (message?.type === 'started' && Number.isInteger(message.pid) && message.pid > 0) {
        onStarted?.(message.pid)
      } else if (message?.type === 'result') {
        const r = message.result
        if (!r || !(r.exitCode === null || Number.isInteger(r.exitCode)) ||
          typeof r.stdout !== 'string' || typeof r.stderr !== 'string' ||
          typeof r.truncated !== 'boolean' || !Number.isFinite(r.durationMs) ||
          r.stdout.length + r.stderr.length > 2 * 1024 * 1024) {
          finish(new Error('INVALID_WORKER_RESULT'))
        } else finish(cancellation ? new Error('COMMAND_CANCELLED') : undefined, r)
      } else if (message?.type === 'error') {
        finish(new Error(typeof message.message === 'string' ? message.message : 'COMMAND_FAILED'))
      }
    })
    if (signal.aborted) abort()
  })
}

export interface RunningUtilityService {
  pid: number
  completion: Promise<ExecutionResult>
}

/** Resolves on real child start while retaining a consumed completion promise for lifecycle cleanup. */
export function startLongRunningInUtilityProcess(
  command: LocalCommand,
  signal: AbortSignal,
  output: CommandOutput
): Promise<RunningUtilityService> {
  return new Promise((resolve, reject) => {
    let started = false
    const completion = executeInUtilityProcess(command, signal, output, (pid) => {
      if (started) return
      started = true
      resolve({ pid, completion })
    })
    void completion.catch((error) => {
      if (!started) reject(error)
    })
  })
}
