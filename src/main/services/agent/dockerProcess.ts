import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { ExecutionResult } from '../../../shared/agent'
import { dockerCliEnvironment } from './dockerPreflight'

const MAX_OUTPUT = 1024 * 1024

export async function runDockerCli(
  executable: string,
  args: string[],
  signal: AbortSignal,
  timeoutMs: number,
  output: (stream: 'stdout' | 'stderr', chunk: string) => void = () => undefined
): Promise<ExecutionResult> {
  if (signal.aborted) throw new Error('COMMAND_CANCELLED')
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false, windowsHide: true, env: dockerCliEnvironment(), stdio: ['ignore', 'pipe', 'pipe']
    })
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
    let stdout = '', stderr = '', bytes = 0, truncated = false, stopReason: string | undefined
    const append = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const kept = chunk.subarray(0, Math.max(0, MAX_OUTPUT - bytes))
      bytes += kept.length
      if (kept.length !== chunk.length) truncated = true
      const text = decoders[stream].write(kept)
      if (stream === 'stdout') stdout += text
      else stderr += text
      if (text) {
        try { output(stream, text) } catch { stop('OUTPUT_HANDLER_FAILED') }
      }
    }
    const stop = (reason: string): void => {
      stopReason ??= reason
      child.kill('SIGKILL')
    }
    const abort = (): void => stop('COMMAND_CANCELLED')
    const timer = setTimeout(() => stop('COMMAND_TIMEOUT'), timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))
    child.once('error', (error) => { cleanup(); reject(error) })
    child.once('close', (exitCode) => {
      cleanup()
      stdout += decoders.stdout.end()
      stderr += decoders.stderr.end()
      if (stopReason) reject(new Error(stopReason))
      else resolve({ exitCode, durationMs: Date.now() - started, stdout, stderr, truncated })
    })
  })
}
