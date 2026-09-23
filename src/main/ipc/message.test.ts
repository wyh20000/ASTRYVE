import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  store: undefined as unknown
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
    mocks.handlers.set(name, handler)
  } }
}))
vi.mock('../db', () => ({ getStore: () => mocks.store }))
vi.mock('../services/modelConfig', () => ({
  getActivePreset: () => null,
  getModelConfig: () => ({ reasoningEffort: 'medium' })
}))
vi.mock('../services/agent/taskRuntimeManager', () => ({
  cancelTasksForSession: () => 0,
  createBrowserTask: vi.fn(), createProjectTask: vi.fn(), getPatchWorkspaceService: vi.fn(),
  getTaskRuntime: vi.fn(), getToolRegistry: vi.fn(), shouldUseProjectAgent: () => false,
  writeAgentAudit: vi.fn()
}))
vi.mock('../services/agent/pluginManager', () => ({ listPlugins: async () => [] }))
vi.mock('../services/agent/toolCallingLoop', () => ({ runInteractiveChatLoop: vi.fn(), runToolCallingLoop: vi.fn() }))
vi.mock('../services/agent/userInput', () => ({ requestUserInput: vi.fn(), submitUserInput: () => false }))
vi.mock('../services/agent/workspaceManager', () => ({ getWorkspaceService: vi.fn(), restoreSessionWorkspace: vi.fn() }))
vi.mock('../services/agent/skillManager', () => ({ auditSkillUse: vi.fn(), resolveSkills: vi.fn() }))
vi.mock('../services/browser/officialChromeBrowserRuntime', () => ({ acquireOfficialChromeBrowserLease: vi.fn() }))

import { IPC, EVENTS } from '@shared/ipc'
import { MemoryStore } from '../db/memory'
import { configureTrustedIpcSender, setBusinessIpcAvailable } from './validation'
import { registerMessageIpc } from './message'

function event(): unknown {
  const frame = { url: 'file:///D:/app/index.html' }
  return {
    senderFrame: frame,
    sender: { id: 42, mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false, send: vi.fn() }
  }
}

describe('message IPC send lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.handlers.clear()
    mocks.store = new MemoryStore()
    configureTrustedIpcSender('file:///D:/app/index.html')
    setBusinessIpcAvailable(true)
    registerMessageIpc()
  })

  it('is idempotent and reaches a correlated persistent terminal message', async () => {
    const store = mocks.store as MemoryStore
    const session = await store.createSession('')
    const clientMessageId = crypto.randomUUID()
    const send = mocks.handlers.get(IPC.message.send)!
    const invocation = event() as { sender: { send: ReturnType<typeof vi.fn> } }
    const input = { clientMessageId, sessionId: session.id, content: 'hello' }

    const first = await send(invocation, input) as { ok: boolean; data: { id: string } }
    expect(first).toMatchObject({ ok: true, data: { id: clientMessageId } })
    await vi.runAllTimersAsync()

    const messages = await store.listMessages(session.id)
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      role: 'assistant', generationId: clientMessageId, status: 'done', finishReason: 'completed'
    })
    expect(invocation.sender.send).toHaveBeenCalledWith(
      EVENTS.messageStreamed,
      expect.objectContaining({ generationId: clientMessageId, status: 'done' })
    )

    const retry = await send(invocation, input) as { ok: boolean; data: { id: string } }
    expect(retry).toMatchObject({ ok: true, data: { id: clientMessageId } })
    expect(await store.listMessages(session.id)).toHaveLength(2)
  })
})
