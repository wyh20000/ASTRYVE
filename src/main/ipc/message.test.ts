import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
import { SqliteStore } from '../db/sqlite'
import { initArtifactStore } from '../services/artifactStore'
import { configureTrustedIpcSender, setBusinessIpcAvailable } from './validation'
import { buildHistory, registerMessageIpc } from './message'

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

  it('includes saved document evidence on a later turn after the active request is replaced', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astryve-history-'))
    try {
      const artifacts = initArtifactStore(root)
      const stored = await artifacts.putText('支付失败时需要重试一次。\n\n如果仍失败，应联系支持。', 'document')
      const database = mocks.store as MemoryStore
      const session = await database.createSession('doc')
      await database.insertMessage({
        sessionId: session.id, role: 'user', content: '分析文档',
        attachments: [{ id: 'doc', kind: 'file', name: 'guide.txt', contentType: 'text/plain', dataRef: '',
          meta: { documentRef: stored.ref, parsed: true } }],
        turn: { id: 'turn-1', sessionId: session.id, createdAt: 1, text: '分析文档', imageRefs: [],
          documentRefs: [stored.ref], skillIds: [], pluginIds: [] }
      })
      await database.insertMessage({ sessionId: session.id, role: 'assistant', content: '收到', timestamp: Date.now() + 1 })
      await database.insertMessage({ sessionId: session.id, role: 'user', content: '/review 文档支付失败怎么办', timestamp: Date.now() + 2 })
      const history = await buildHistory(session.id, 20, false, [], 16_000, false,
        undefined, undefined, '', '文档支付失败怎么办')
      expect(history.at(-1)?.content).toContain('支付失败时需要重试一次')
      expect(history.at(-1)?.content).toContain('guide.txt')
      expect(JSON.stringify(history)).not.toContain('/review')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restores a document for a follow-up after restart without leaking it to another session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astryve-restart-history-'))
    let database: SqliteStore | undefined
    try {
      const artifacts = initArtifactStore(root)
      const document = await artifacts.putText('项目预算为 300 元。', 'document')
      database = await SqliteStore.open(join(root, 'messages.sqlite'))
      mocks.store = database
      const first = await database.createSession('A')
      const second = await database.createSession('B')
      await database.insertMessage({
        sessionId: first.id, role: 'user', content: '看文档',
        attachments: [{ id: 'file', kind: 'file', name: 'budget.txt', contentType: 'text/plain', dataRef: '',
          meta: { documentRef: document.ref } }],
        turn: { id: 'turn', sessionId: first.id, createdAt: 1, text: '看文档', imageRefs: [],
          documentRefs: [document.ref], skillIds: [], pluginIds: [] }
      })
      database.close()
      database = await SqliteStore.open(join(root, 'messages.sqlite'))
      mocks.store = database
      await database.insertMessage({ sessionId: first.id, role: 'user', content: '预算是多少？' })
      await database.insertMessage({ sessionId: second.id, role: 'user', content: '预算是多少？' })

      const firstHistory = await buildHistory(first.id, 20, false, [], 16_000)
      const secondHistory = await buildHistory(second.id, 20, false, [], 16_000)
      expect(JSON.stringify(firstHistory)).toContain('300 元')
      expect(JSON.stringify(secondHistory)).not.toContain('300 元')
    } finally {
      database?.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
