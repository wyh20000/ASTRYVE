import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginWorkerDefinition, PluginWorkerHostMessage } from '../../../shared/pluginProtocol'
import { PluginWorkerHost, type PluginChildProcess, type PluginProcessFactory } from './pluginWorker'

class FakeChild extends EventEmitter implements PluginChildProcess {
  pid: number | undefined = 42
  postMessage = vi.fn((_message: PluginWorkerHostMessage) => undefined)
  kill = vi.fn(() => true)
}

const definition: PluginWorkerDefinition = {
  pluginId: 'acme.browser',
  rootPath: 'C:\\plugins\\acme.browser',
  tools: [
    { name: 'inspect', entryPath: 'inspect.js' },
    { name: 'click', entryPath: 'click.js' }
  ]
}

function setup(options: Partial<ConstructorParameters<typeof PluginWorkerHost>[0]> = {}) {
  const child = new FakeChild()
  const fork: PluginProcessFactory = vi.fn(() => child)
  const host = new PluginWorkerHost({
    workerPath: 'pluginWorkerProcess.js', fork,
    startupTimeoutMs: 100, heartbeatTimeoutMs: 100,
    invocationTimeoutMs: 100, stopGraceMs: 25,
    ...options
  })
  const start = host.start(definition)
  child.emit('spawn')
  return { child, fork, host, start }
}

function ready(child: FakeChild): void {
  child.emit('message', { type: 'plugin.ready', protocolVersion: 1, pluginId: definition.pluginId })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PluginWorkerHost', () => {
  it('uses an allowlisted environment and waits for a matching startup handshake', async () => {
    const { child, fork, start } = setup()
    expect(fork).toHaveBeenCalledWith('pluginWorkerProcess.js', [], expect.objectContaining({
      env: expect.not.objectContaining({ OPENAI_API_KEY: expect.anything() }),
      stdio: 'ignore'
    }))
    expect(child.postMessage).toHaveBeenCalledWith({
      type: 'plugin.init', protocolVersion: 1, plugin: definition
    })
    ready(child)
    await expect(start).resolves.toBeUndefined()
  })

  it('resolves one invocation once and ignores a duplicate result for the same id', async () => {
    const { child, host, start } = setup()
    ready(child)
    await start
    const result = host.invoke('inspect', { selector: '#app' }, { taskId: 'task-1' })
    const call = child.postMessage.mock.calls.at(-1)?.[0]
    expect(call).toMatchObject({ type: 'plugin.invoke', toolName: 'inspect', args: { selector: '#app' } })
    if (call?.type !== 'plugin.invoke') throw new Error('expected invocation')
    child.emit('message', { type: 'plugin.result', protocolVersion: 1, id: call.id, result: { ok: true } })
    child.emit('message', { type: 'plugin.result', protocolVersion: 1, id: call.id, result: { ok: false } })
    await expect(result).resolves.toEqual({ ok: true })
  })

  it('cancels a timed-out or aborted invocation without stopping healthy siblings', async () => {
    vi.useFakeTimers()
    const { child, host, start } = setup({ invocationTimeoutMs: 20 })
    ready(child)
    await start
    const timedOut = host.invoke('inspect', {}, { taskId: 'task-1' })
    const timedOutAssertion = expect(timedOut).rejects.toThrow('PLUGIN_CALL_TIMEOUT')
    const timeoutCall = child.postMessage.mock.calls.at(-1)?.[0]
    await vi.advanceTimersByTimeAsync(20)
    await timedOutAssertion
    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'plugin.cancel', id: timeoutCall?.type === 'plugin.invoke' ? timeoutCall.id : ''
    }))

    const controller = new AbortController()
    const cancelled = host.invoke('click', {}, { taskId: 'task-1' }, controller.signal)
    const cancelledCall = child.postMessage.mock.calls.at(-1)?.[0]
    controller.abort()
    await expect(cancelled).rejects.toThrow('PLUGIN_CALL_CANCELLED')
    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'plugin.cancel', id: cancelledCall?.type === 'plugin.invoke' ? cancelledCall.id : ''
    }))
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('uses heartbeat activity to detect an unresponsive worker', async () => {
    vi.useFakeTimers()
    const { child, host, start } = setup({ heartbeatTimeoutMs: 40 })
    ready(child)
    await start
    const pending = host.invoke('inspect', {}, { taskId: 'task-1' })
    const pendingAssertion = expect(pending).rejects.toThrow('PLUGIN_HEARTBEAT_TIMEOUT')
    await vi.advanceTimersByTimeAsync(25)
    child.emit('message', { type: 'plugin.heartbeat', protocolVersion: 1, timestamp: Date.now() })
    await vi.advanceTimersByTimeAsync(25)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20)
    await pendingAssertion
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it.each([
    ['malformed', { type: 'plugin.result', protocolVersion: 1 }],
    ['oversized', { type: 'plugin.result', protocolVersion: 1, id: 'unknown', result: 'x'.repeat(201 * 1024) }]
  ])('terminates only this worker for a %s message', async (_label, message) => {
    const { child, host, start } = setup()
    ready(child)
    await start
    const pending = host.invoke('inspect', {}, { taskId: 'task-1' })
    child.emit('message', message)
    await expect(pending).rejects.toThrow('PLUGIN_PROTOCOL_ERROR')
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('isolates a worker crash and rejects only its pending calls', async () => {
    const { child, host, start } = setup()
    ready(child)
    await start
    const pending = host.invoke('inspect', {}, { taskId: 'task-1' })
    child.emit('exit', 7)
    await expect(pending).rejects.toThrow('PLUGIN_WORKER_EXITED')
    await expect(host.invoke('inspect', {}, { taskId: 'task-1' })).rejects.toThrow('PLUGIN_WORKER_NOT_READY')
  })

  it('forces termination when graceful stop exceeds its deadline', async () => {
    vi.useFakeTimers()
    const { child, host, start } = setup({ stopGraceMs: 20 })
    ready(child)
    await start
    const stopping = host.stop('disabled')
    expect(child.postMessage).toHaveBeenCalledWith({
      type: 'plugin.stop', protocolVersion: 1, reason: 'disabled'
    })
    await vi.advanceTimersByTimeAsync(20)
    await stopping
    expect(child.kill).toHaveBeenCalledOnce()
  })
})
