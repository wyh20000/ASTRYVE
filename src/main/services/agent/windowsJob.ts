import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { ExecutionResult } from '../../../shared/agent'
import type { LocalCommand, CommandOutput } from './localCommand'

/** JobHost is app-owned; never resolve this helper through project PATH. */
export function runWindowsJob(helper: string, command: LocalCommand, signal: AbortSignal,
  output: CommandOutput, onHost?: (pid: number) => void): Promise<ExecutionResult> {
  if (signal.aborted) return Promise.reject(new Error('COMMAND_CANCELLED'))
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const host = spawn(helper, [], { windowsHide: true, shell: false, env: command.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', size = 0, truncated = false
    let error: Error | undefined, exitCode: number | undefined
    const stop = (message: string) => { error ??= new Error(message); host.kill('SIGKILL') }
    const abort = () => stop('COMMAND_CANCELLED')
    const timer = setTimeout(() => stop('COMMAND_TIMEOUT'), command.timeoutMs + 2500)
    signal.addEventListener('abort', abort, { once: true })
    host.on('spawn', () => {
      if (signal.aborted) { abort(); return }
      host.stdin.write(JSON.stringify(command) + '\n')
      if (host.pid) onHost?.(host.pid)
    })
    host.stdin.on('error', () => stop('JOB_PIPE_FAILED'))
    host.stderr.resume()
    const lines = createInterface({ input: host.stdout })
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line)
        if (message.type === 'error') { error = new Error(message.message); return }
        if (message.type === 'exit' && Number.isInteger(message.exitCode)) { exitCode = message.exitCode; return }
        if (message.type !== 'output') return
        if (!['stdout', 'stderr'].includes(message.stream) || typeof message.text !== 'string') throw new Error()
        const bytes = Buffer.from(message.text)
        const remaining = Math.max(0, 1024 * 1024 - size)
        const kept = bytes.subarray(0, remaining)
        size += kept.length; truncated ||= kept.length !== bytes.length
        const text = kept.toString('utf8')
        if (message.stream === 'stdout') stdout += text; else stderr += text
        if (text) output(message.stream, text)
      } catch { stop('INVALID_JOB_OUTPUT') }
    })
    host.once('error', (cause) => { error = cause })
    host.once('close', () => {
      clearTimeout(timer); signal.removeEventListener('abort', abort); lines.close()
      if (error) reject(error)
      else if (exitCode === undefined) reject(new Error('JOB_HOST_EXITED'))
      else resolve({ exitCode, durationMs: Date.now() - start, stdout, stderr, truncated })
    })
    if (signal.aborted) abort()
  })
}
