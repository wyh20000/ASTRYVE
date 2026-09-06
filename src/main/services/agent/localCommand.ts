import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { ExecutionResult, NormalizedCommand } from '../../../shared/agent'

export interface LocalCommand extends NormalizedCommand { }
export type CommandOutput = (stream: 'stdout' | 'stderr', text: string) => void
const MAX_OUTPUT = 1024 * 1024

/** Worker-only primitive; authorization and executable resolution must precede this call. */
export function runLocalCommand(
  command: LocalCommand,
  signal: AbortSignal,
  output: CommandOutput,
  onStarted?: (pid: number) => void
): Promise<ExecutionResult> {
  validateLocalCommand(command)
  if (signal.aborted) return Promise.reject(new Error('COMMAND_CANCELLED'))
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd, env: command.env, shell: false, windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = '', stderr = '', size = 0, truncated = false
    let stopReason: string | undefined
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
    const emit = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const available = Math.max(0, MAX_OUTPUT - size)
      const kept = chunk.subarray(0, available)
      size += kept.length
      if (kept.length !== chunk.length) truncated = true
      const text = decoders[stream].write(kept)
      if (stream === 'stdout') stdout += text
      else stderr += text
      if (text) {
        try { output(stream, text) } catch { stop('OUTPUT_HANDLER_FAILED') }
      }
    }
    const stop = (reason: string) => {
      stopReason ??= reason
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); return } catch { /* fall through */ }
      }
      child.kill('SIGKILL')
    }
    const abort = () => stop('COMMAND_CANCELLED')
    const timer = setTimeout(() => stop('COMMAND_TIMEOUT'), command.timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    child.stdout.on('data', (chunk: Buffer) => emit('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => emit('stderr', chunk))
    child.once('spawn', () => {
      if (child.pid) onStarted?.(child.pid)
    })
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

export function validateLocalCommand(input: unknown): asserts input is LocalCommand {
  if (!input || typeof input !== 'object') throw new Error('INVALID_COMMAND')
  const c = input as Partial<LocalCommand>
  if (typeof c.executable !== 'string' || !isAbsolute(c.executable) || /[\0\r\n]/.test(c.executable) ||
    /\.(?:cmd|bat|ps1)$/i.test(c.executable) || typeof c.cwd !== 'string' || !isAbsolute(c.cwd) ||
    !Array.isArray(c.args) || c.args.length > 256 || c.args.some((arg) => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0')) ||
    !Number.isInteger(c.timeoutMs) || c.timeoutMs! < 1 || c.timeoutMs! > 600_000 ||
    (c.expectedPorts !== undefined && (
      !Array.isArray(c.expectedPorts) || c.expectedPorts.length > 16 ||
      c.expectedPorts.some((port) => !Number.isSafeInteger(port) || port < 1 || port > 65_535) ||
      new Set(c.expectedPorts).size !== c.expectedPorts.length
    )) ||
    !c.env || typeof c.env !== 'object' || Array.isArray(c.env) ||
    Object.entries(c.env).some(([key, value]) => ![
      'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'CI', 'NO_COLOR', 'LANG', 'LC_ALL',
      'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_OPTIONAL_LOCKS', 'GIT_PAGER',
      'GIT_TERMINAL_PROMPT', 'PAGER', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
      'PYTHONUTF8', 'PYTHONIOENCODING'
    ].includes(key.toUpperCase()) || typeof value !== 'string' || /[\0\r\n]/.test(value))) {
    throw new Error('INVALID_COMMAND')
  }
}
