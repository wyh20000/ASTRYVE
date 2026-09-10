import { randomUUID } from 'node:crypto'
import { isAbsolute, normalize, win32 } from 'node:path'
import { utilityProcess, type ForkOptions } from 'electron'
import {
  isPluginWorkerDefinition,
  isPluginWorkerMessage,
  PLUGIN_MESSAGE_LIMIT_BYTES,
  PLUGIN_PROTOCOL_VERSION,
  serializedPluginMessageSize,
  type PluginInvocationContext,
  type PluginWorkerDefinition,
  type PluginWorkerHostMessage
} from '../../../shared/pluginProtocol'

export interface PluginChildProcess {
  pid: number | undefined
  postMessage(message: PluginWorkerHostMessage): void
  kill(): boolean
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  once(event: 'spawn', listener: () => void): this
  once(event: 'error', listener: (...args: unknown[]) => void): this
}

export type PluginProcessFactory = (modulePath: string, args: string[], options: ForkOptions) => PluginChildProcess

interface PluginWorkerOptions {
  workerPath: string
  fork?: PluginProcessFactory
  startupTimeoutMs?: number
  heartbeatTimeoutMs?: number
  invocationTimeoutMs?: number
  stopGraceMs?: number
  maxMessageBytes?: number
}

interface PendingCall {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  abort?: () => void
}

type State = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped'

/** Crash and protocol isolation boundary. Capability authorization remains outside this class. */
export class PluginWorkerHost {
  private readonly options: Required<Omit<PluginWorkerOptions, 'fork'>>
  private readonly fork: PluginProcessFactory
  private child?: PluginChildProcess
  private definition?: PluginWorkerDefinition
  private state: State = 'idle'
  private startupTimer?: ReturnType<typeof setTimeout>
  private heartbeatTimer?: ReturnType<typeof setTimeout>
  private stopTimer?: ReturnType<typeof setTimeout>
  private startResolve?: () => void
  private startReject?: (error: Error) => void
  private stopResolve?: () => void
  private readonly pending = new Map<string, PendingCall>()

  constructor(options: PluginWorkerOptions) {
    this.options = {
      workerPath: options.workerPath,
      startupTimeoutMs: options.startupTimeoutMs ?? 5_000,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 15_000,
      invocationTimeoutMs: options.invocationTimeoutMs ?? 30_000,
      stopGraceMs: options.stopGraceMs ?? 500,
      maxMessageBytes: options.maxMessageBytes ?? PLUGIN_MESSAGE_LIMIT_BYTES
    }
    this.fork = options.fork ?? ((modulePath, args, forkOptions) => utilityProcess.fork(modulePath, args, forkOptions))
  }

  start(definition: PluginWorkerDefinition): Promise<void> {
    if (this.state !== 'idle') return Promise.reject(new Error('PLUGIN_WORKER_ALREADY_STARTED'))
    validateDefinition(definition)
    this.definition = structuredClone(definition)
    this.state = 'starting'
    return new Promise((resolve, reject) => {
      this.startResolve = resolve
      this.startReject = reject
      this.startupTimer = setTimeout(() => this.failWorker('PLUGIN_STARTUP_TIMEOUT'), this.options.startupTimeoutMs)
      this.startupTimer.unref?.()
      try {
        this.child = this.fork(this.options.workerPath, [], {
          serviceName: `AI Agent plugin ${definition.pluginId}`,
          env: allowlistedEnvironment(),
          stdio: 'ignore'
        })
        this.child.on('message', (message) => this.handleMessage(message))
        this.child.on('exit', (code) => this.handleExit(code))
        this.child.once('error', () => this.failWorker('PLUGIN_WORKER_ERROR'))
        this.child.once('spawn', () => {
          if (this.state !== 'starting') return
          this.send({ type: 'plugin.init', protocolVersion: PLUGIN_PROTOCOL_VERSION, plugin: this.definition! })
        })
      } catch {
        this.failWorker('PLUGIN_WORKER_START_FAILED', false)
      }
    })
  }

  invoke(toolName: string, args: unknown, context: PluginInvocationContext, signal?: AbortSignal): Promise<unknown> {
    if (this.state !== 'ready' || !this.definition) return Promise.reject(new Error('PLUGIN_WORKER_NOT_READY'))
    if (!this.definition.tools.some((tool) => tool.name === toolName)) return Promise.reject(new Error('PLUGIN_TOOL_NOT_DECLARED'))
    if (signal?.aborted) return Promise.reject(new Error('PLUGIN_CALL_CANCELLED'))
    const id = randomUUID()
    const message: PluginWorkerHostMessage = {
      type: 'plugin.invoke', protocolVersion: PLUGIN_PROTOCOL_VERSION, id, toolName,
      args: structuredClone(args), context: structuredClone(context)
    }
    if (serializedPluginMessageSize(message) > this.options.maxMessageBytes) return Promise.reject(new Error('PLUGIN_MESSAGE_TOO_LARGE'))

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cancelCall(id, 'timeout', 'PLUGIN_CALL_TIMEOUT')
      }, this.options.invocationTimeoutMs)
      timer.unref?.()
      const pending: PendingCall = { resolve, reject, timer, signal }
      if (signal) {
        pending.abort = () => this.cancelCall(id, 'cancelled', 'PLUGIN_CALL_CANCELLED')
        signal.addEventListener('abort', pending.abort, { once: true })
      }
      this.pending.set(id, pending)
      this.send(message)
    })
  }

  stop(reason: string): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') return Promise.resolve()
    if (this.state === 'stopping') return new Promise((resolve) => {
      const previous = this.stopResolve
      this.stopResolve = () => { previous?.(); resolve() }
    })
    this.state = 'stopping'
    this.clearRuntimeTimers()
    this.rejectAll('PLUGIN_WORKER_STOPPED')
    this.startReject?.(new Error('PLUGIN_WORKER_STOPPED'))
    this.clearStartDeferred()
    this.send({ type: 'plugin.stop', protocolVersion: PLUGIN_PROTOCOL_VERSION, reason: safeReason(reason) })
    return new Promise((resolve) => {
      this.stopResolve = resolve
      this.stopTimer = setTimeout(() => {
        this.child?.kill()
        this.finishStopped()
      }, this.options.stopGraceMs)
      this.stopTimer.unref?.()
    })
  }

  private handleMessage(message: unknown): void {
    if (serializedPluginMessageSize(message) > this.options.maxMessageBytes || !isPluginWorkerMessage(message)) {
      this.failWorker('PLUGIN_PROTOCOL_ERROR')
      return
    }
    if (message.type === 'plugin.ready') {
      if (this.state !== 'starting' || message.pluginId !== this.definition?.pluginId) {
        this.failWorker('PLUGIN_PROTOCOL_ERROR')
        return
      }
      this.state = 'ready'
      if (this.startupTimer) clearTimeout(this.startupTimer)
      this.startupTimer = undefined
      this.armHeartbeat()
      this.startResolve?.()
      this.clearStartDeferred()
      return
    }
    if (message.type === 'plugin.heartbeat') {
      if (this.state !== 'ready') { this.failWorker('PLUGIN_PROTOCOL_ERROR'); return }
      this.armHeartbeat()
      return
    }
    if (message.type === 'plugin.fatal') {
      this.failWorker('PLUGIN_WORKER_FATAL')
      return
    }
    if (message.type === 'plugin.result') {
      const pending = this.takePending(message.id)
      pending?.resolve(message.result)
      return
    }
    const pending = this.takePending(message.id)
    pending?.reject(new Error(`PLUGIN_CALL_FAILED:${message.code}:${message.message}`))
  }

  private handleExit(_code: number): void {
    if (this.state === 'stopped') return
    if (this.state === 'stopping') { this.finishStopped(); return }
    this.failWorker('PLUGIN_WORKER_EXITED', false)
  }

  private cancelCall(id: string, reason: string, errorCode: string): void {
    const pending = this.takePending(id)
    if (!pending) return
    if (this.state === 'ready') this.send({ type: 'plugin.cancel', protocolVersion: PLUGIN_PROTOCOL_VERSION, id, reason })
    pending.reject(new Error(errorCode))
  }

  private takePending(id: string): PendingCall | undefined {
    const pending = this.pending.get(id)
    if (!pending) return undefined
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (pending.signal && pending.abort) pending.signal.removeEventListener('abort', pending.abort)
    return pending
  }

  private armHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = setTimeout(() => this.failWorker('PLUGIN_HEARTBEAT_TIMEOUT'), this.options.heartbeatTimeoutMs)
    this.heartbeatTimer.unref?.()
  }

  private send(message: PluginWorkerHostMessage): void {
    if (serializedPluginMessageSize(message) > this.options.maxMessageBytes) {
      this.failWorker('PLUGIN_PROTOCOL_ERROR')
      return
    }
    this.child?.postMessage(message)
  }

  private failWorker(code: string, kill = true): void {
    if (this.state === 'stopped') return
    this.state = 'stopped'
    this.clearRuntimeTimers()
    this.startReject?.(new Error(code))
    this.clearStartDeferred()
    this.rejectAll(code)
    if (kill) this.child?.kill()
    this.stopResolve?.()
    this.stopResolve = undefined
  }

  private finishStopped(): void {
    this.state = 'stopped'
    this.clearRuntimeTimers()
    this.stopResolve?.()
    this.stopResolve = undefined
  }

  private rejectAll(code: string): void {
    for (const id of [...this.pending.keys()]) this.takePending(id)?.reject(new Error(code))
  }

  private clearRuntimeTimers(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.startupTimer = undefined
    this.heartbeatTimer = undefined
    this.stopTimer = undefined
  }

  private clearStartDeferred(): void {
    this.startResolve = undefined
    this.startReject = undefined
  }
}

function validateDefinition(definition: PluginWorkerDefinition): void {
  if (!isPluginWorkerDefinition(definition)) throw new Error('PLUGIN_DEFINITION_INVALID')
  if (!isAbsolute(definition.rootPath) && !win32.isAbsolute(definition.rootPath)) throw new Error('PLUGIN_ROOT_INVALID')
  for (const tool of definition.tools) {
    const entry = normalize(tool.entryPath)
    if (isAbsolute(entry) || win32.isAbsolute(entry) || entry === '..' || entry.startsWith(`..\\`) || entry.startsWith('../')) {
      throw new Error('PLUGIN_ENTRY_OUTSIDE_ROOT')
    }
  }
}

function allowlistedEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'LANG', 'LC_ALL']) {
    if (process.env[key] !== undefined) result[key] = process.env[key]
  }
  return result
}

function safeReason(reason: string): string {
  const value = reason.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 256)
  return value || 'stopped'
}
