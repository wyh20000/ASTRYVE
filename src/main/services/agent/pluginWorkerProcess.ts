import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  isPluginWorkerHostMessage,
  PLUGIN_MESSAGE_LIMIT_BYTES,
  PLUGIN_PROTOCOL_VERSION,
  serializedPluginMessageSize,
  type PluginInvocationContext,
  type PluginWorkerDefinition,
  type PluginWorkerMessage
} from '../../../shared/pluginProtocol'

type PluginToolHandler = (
  args: unknown,
  context: PluginInvocationContext & { signal: AbortSignal }
) => unknown | Promise<unknown>

const port = process.parentPort
const handlers = new Map<string, PluginToolHandler>()
const calls = new Map<string, AbortController>()
let pluginId = ''
let initialized = false
let stopping = false
let heartbeat: ReturnType<typeof setInterval> | undefined

port.on('message', (event: { data: unknown }) => {
  const message = event.data
  if (serializedPluginMessageSize(message) > PLUGIN_MESSAGE_LIMIT_BYTES || !isPluginWorkerHostMessage(message)) {
    fatal('INVALID_HOST_MESSAGE', '插件进程收到无效消息')
    return
  }
  if (message.type === 'plugin.init') {
    if (initialized) { fatal('DUPLICATE_INIT', '插件进程被重复初始化'); return }
    initialized = true
    void initialize(message.plugin)
    return
  }
  if (!initialized || stopping) { fatal('WORKER_NOT_READY', '插件进程尚未就绪'); return }
  if (message.type === 'plugin.invoke') {
    if (calls.has(message.id)) { sendError(message.id, 'DUPLICATE_CALL', '重复的插件调用标识'); return }
    const handler = handlers.get(message.toolName)
    if (!handler) { sendError(message.id, 'TOOL_NOT_DECLARED', '插件工具未声明'); return }
    const controller = new AbortController()
    calls.set(message.id, controller)
    void Promise.resolve()
      .then(() => handler(message.args, { ...message.context, signal: controller.signal }))
      .then((result) => {
        if (controller.signal.aborted || stopping) return
        const response: PluginWorkerMessage = { type: 'plugin.result', protocolVersion: PLUGIN_PROTOCOL_VERSION, id: message.id, result }
        if (serializedPluginMessageSize(response) > PLUGIN_MESSAGE_LIMIT_BYTES) {
          sendError(message.id, 'RESULT_TOO_LARGE', '插件返回结果超过大小限制')
        } else port.postMessage(response)
      })
      .catch((error) => {
        if (!controller.signal.aborted && !stopping) sendError(message.id, 'TOOL_FAILED', safeErrorMessage(error))
      })
      .finally(() => calls.delete(message.id))
    return
  }
  if (message.type === 'plugin.cancel') {
    calls.get(message.id)?.abort()
    return
  }
  if (message.type === 'plugin.stop') {
    stop()
    return
  }
  fatal('INVALID_HOST_MESSAGE', '插件进程收到无效消息')
})

async function initialize(definition: PluginWorkerDefinition): Promise<void> {
  try {
    pluginId = definition.pluginId
    const root = await realpath(definition.rootPath)
    for (const tool of definition.tools) {
      const entry = await resolveEntry(root, tool.entryPath)
      const loaded = await import(pathToFileURL(entry).href)
      const handler = loaded.default ?? loaded[tool.name] ?? loaded.handler
      if (typeof handler !== 'function') throw new Error(`工具 ${tool.name} 没有导出可调用函数`)
      handlers.set(tool.name, handler as PluginToolHandler)
    }
    heartbeat = setInterval(() => {
      post({ type: 'plugin.heartbeat', protocolVersion: PLUGIN_PROTOCOL_VERSION, timestamp: Date.now() })
    }, 2_000)
    heartbeat.unref()
    post({ type: 'plugin.ready', protocolVersion: PLUGIN_PROTOCOL_VERSION, pluginId })
  } catch (error) {
    fatal('PLUGIN_LOAD_FAILED', safeErrorMessage(error))
  }
}

async function resolveEntry(root: string, entryPath: string): Promise<string> {
  if (isAbsolute(entryPath) || win32.isAbsolute(entryPath)) throw new Error('插件入口必须位于插件目录内')
  const candidate = resolve(root, entryPath)
  const candidateInfo = await lstat(candidate)
  if (!candidateInfo.isFile() || candidateInfo.isSymbolicLink()) throw new Error('插件入口不是普通文件')
  const resolved = await realpath(candidate)
  const within = relative(root, resolved)
  if (!within || within === '..' || within.startsWith(`..\\`) || within.startsWith('../') || isAbsolute(within)) {
    throw new Error('插件入口必须位于插件目录内')
  }
  return resolved
}

function sendError(id: string, code: string, message: string): void {
  post({ type: 'plugin.error', protocolVersion: PLUGIN_PROTOCOL_VERSION, id, code, message: message.slice(0, 2_000) })
}

function fatal(code: string, message: string): void {
  if (stopping) return
  stopping = true
  for (const controller of calls.values()) controller.abort()
  calls.clear()
  if (heartbeat) clearInterval(heartbeat)
  post({ type: 'plugin.fatal', protocolVersion: PLUGIN_PROTOCOL_VERSION, code, message: message.slice(0, 2_000) })
  setImmediate(() => process.exit(1))
}

function stop(): void {
  if (stopping) return
  stopping = true
  if (heartbeat) clearInterval(heartbeat)
  for (const controller of calls.values()) controller.abort()
  calls.clear()
  setImmediate(() => process.exit(0))
}

function post(message: PluginWorkerMessage): void {
  if (serializedPluginMessageSize(message) <= PLUGIN_MESSAGE_LIMIT_BYTES) port.postMessage(message)
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '插件工具执行失败'
  return message.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 2_000) || '插件工具执行失败'
}
