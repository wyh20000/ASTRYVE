import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  store: undefined as unknown,
  projectEnabled: false,
  plugins: [] as Array<{ id: string; status: string; enabled: boolean }>,
  availableTools: [] as Array<{ function: { name: string } }>,
  preset: null as null | { id: string; provider: 'deepseek' | 'custom'; model: string; baseUrl: string; apiKey: string;
    contextMessages: number; contextTokens: number; capabilities?: { imageInput: boolean; nativeToolCalling?: boolean } },
  createCapabilityTask: vi.fn(async (sessionId: string, _ownerId: number, pluginIds?: readonly string[]) => ({
    id: `capability-${sessionId}`, workspaceId: `capability:${sessionId}`,
    environment: 'local', pluginIds: [...(pluginIds ?? [])], pluginVersions: {},
    capabilityToolNames: mocks.availableTools.map((tool) => tool.function.name)
  })),
  runToolCallingLoop: vi.fn(async (input: { onEvent: (event: unknown) => Promise<void> }) => {
    await input.onEvent({ content: '普通回答' })
    return { status: 'completed' as const, rounds: 1, messages: [] }
  }),
  acquireBrowserLease: vi.fn(() => async () => undefined),
  streamChat: vi.fn(async (_runtime: unknown, _history: unknown, onEvent: (event: unknown) => Promise<void>) => {
    await onEvent({ content: '普通回答' })
  }),
  streamDeepSeekSearch: vi.fn(async (_runtime: unknown, _history: unknown, onEvent: (event: unknown) => Promise<void>) => {
    await onEvent({ content: '搜索回答' })
  })
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
    mocks.handlers.set(name, handler)
  } }
}))
vi.mock('../db', () => ({ getStore: () => mocks.store }))
vi.mock('../services/modelConfig', () => ({
  getActivePreset: () => mocks.preset,
  getModelConfig: () => ({ reasoningEffort: 'medium' })
}))
vi.mock('../services/modelProvider', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/modelProvider')>(),
  streamChat: mocks.streamChat,
  streamDeepSeekSearch: mocks.streamDeepSeekSearch
}))
vi.mock('../services/agent/taskRuntimeManager', () => ({
  cancelTasksForSession: () => 0,
  createBrowserTask: vi.fn(), createCapabilityTask: mocks.createCapabilityTask,
  createProjectTask: vi.fn(), getPatchWorkspaceService: vi.fn(),
  getTaskRuntime: () => ({
    listNativeFunctionTools: () => mocks.availableTools, subscribe: () => () => undefined,
    getTaskSignal: () => new AbortController().signal,
    cancelTask: () => false
  }),
  getToolRegistry: vi.fn(), shouldUseProjectAgent: () => mocks.projectEnabled,
  writeAgentAudit: vi.fn()
}))
vi.mock('../services/agent/pluginManager', () => ({ listPlugins: async () => mocks.plugins }))
vi.mock('../services/agent/toolCallingLoop', () => ({
  runInteractiveChatLoop: vi.fn(), runToolCallingLoop: mocks.runToolCallingLoop
}))
vi.mock('../services/agent/userInput', () => ({ requestUserInput: vi.fn(), submitUserInput: () => false }))
vi.mock('../services/agent/workspaceManager', () => ({ getWorkspaceService: vi.fn(), restoreSessionWorkspace: vi.fn() }))
vi.mock('../services/agent/skillManager', () => ({ auditSkillUse: vi.fn(),
  resolveSkills: vi.fn(async (request: string) => ({ prompt: '', cleanedRequest: request, skills: [] })) }))
vi.mock('../services/browser/officialChromeBrowserRuntime', () => ({
  acquireOfficialChromeBrowserLease: mocks.acquireBrowserLease
}))

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
    mocks.projectEnabled = false
    mocks.plugins = []
    mocks.availableTools = []
    mocks.preset = null
    mocks.streamChat.mockClear()
    mocks.streamDeepSeekSearch.mockClear()
    mocks.createCapabilityTask.mockClear()
    mocks.runToolCallingLoop.mockClear()
    mocks.acquireBrowserLease.mockClear()
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

  it('keeps normal chat offline and uses vendor search only when this turn explicitly selects it', async () => {
    mocks.preset = { id: 'deepseek', provider: 'deepseek', model: 'deepseek-chat',
      baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20, contextTokens: 16000 }
    const store = mocks.store as MemoryStore
    const session = await store.createSession('search')
    const send = mocks.handlers.get(IPC.message.send)!
    await send(event(), { clientMessageId: crypto.randomUUID(), sessionId: session.id, content: '你好' })
    await vi.runAllTimersAsync()
    expect(mocks.runToolCallingLoop).toHaveBeenCalledTimes(1)
    expect(mocks.runToolCallingLoop.mock.calls[0][0]).toMatchObject({
      requireInitialTool: false, allowedToolNames: new Set()
    })
    expect(mocks.streamChat).not.toHaveBeenCalled()
    expect(mocks.acquireBrowserLease).not.toHaveBeenCalled()
    expect(mocks.streamDeepSeekSearch).not.toHaveBeenCalled()
    const ordinaryReply = (await store.listMessages(session.id)).at(-1)
    expect(ordinaryReply?.blocks?.some((block) => block.kind === 'report' || block.kind === 'plan')).toBe(false)

    mocks.projectEnabled = true
    await send(event(), { clientMessageId: crypto.randomUUID(), sessionId: session.id,
      content: '今天新闻', search: true })
    await vi.runAllTimersAsync()
    expect(mocks.streamDeepSeekSearch).toHaveBeenCalledTimes(1)
    expect(Object.fromEntries((await store.listMessages(session.id))
      .filter((message) => message.role === 'user')
      .map((message) => [message.content, message.turn?.searchRequested]))).toEqual({
      '你好': false, '今天新闻': true
    })
  })

  it('keeps a custom endpoint without native tools on ordinary streaming chat', async () => {
    mocks.preset = { id: 'custom', provider: 'custom', model: 'unknown-model',
      baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20, contextTokens: 16000 }
    const store = mocks.store as MemoryStore
    const session = await store.createSession('custom')
    await mocks.handlers.get(IPC.message.send)!(event(), {
      clientMessageId: crypto.randomUUID(), sessionId: session.id, content: '你好'
    })
    await vi.runAllTimersAsync()
    expect(mocks.createCapabilityTask).not.toHaveBeenCalled()
    expect(mocks.runToolCallingLoop).not.toHaveBeenCalled()
    expect(mocks.streamChat).toHaveBeenCalledTimes(1)
    expect((await store.listMessages(session.id)).at(-1)?.status).toBe('done')
  })

  it('does not offer a Chrome task to a model without native tool calling', async () => {
    mocks.preset = { id: 'custom', provider: 'custom', model: 'unknown-model',
      baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20, contextTokens: 16000 }
    const store = mocks.store as MemoryStore
    const session = await store.createSession('browser unsupported')
    await mocks.handlers.get(IPC.message.send)!(event(), {
      clientMessageId: crypto.randomUUID(), sessionId: session.id,
      content: '查看我浏览器当前页面'
    })
    await vi.runAllTimersAsync()
    expect(mocks.createCapabilityTask).not.toHaveBeenCalled()
    expect(mocks.runToolCallingLoop).not.toHaveBeenCalled()
    expect(mocks.streamChat).not.toHaveBeenCalled()
    expect((await store.listMessages(session.id)).at(-1)).toMatchObject({
      role: 'assistant', status: 'error', content: expect.stringContaining('不支持原生工具调用')
    })
  })

  it('persists an error terminal if optional capability task setup fails', async () => {
    mocks.preset = { id: 'deepseek', provider: 'deepseek', model: 'deepseek-chat',
      baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20, contextTokens: 16000 }
    mocks.createCapabilityTask.mockRejectedValueOnce(new Error('能力初始化失败'))
    const store = mocks.store as MemoryStore
    const session = await store.createSession('setup failure')
    await mocks.handlers.get(IPC.message.send)!(event(), {
      clientMessageId: crypto.randomUUID(), sessionId: session.id, content: '你好'
    })
    await vi.runAllTimersAsync()
    expect(mocks.runToolCallingLoop).not.toHaveBeenCalled()
    expect((await store.listMessages(session.id)).at(-1)).toMatchObject({
      role: 'assistant', status: 'error'
    })
  })

  it('persists an error terminal when plugin selection fails before task creation', async () => {
    mocks.preset = { id: 'deepseek', provider: 'deepseek', model: 'deepseek-chat',
      baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20, contextTokens: 16000 }
    const store = mocks.store as MemoryStore
    const session = await store.createSession('missing plugin')
    await mocks.handlers.get(IPC.message.send)!(event(), {
      clientMessageId: crypto.randomUUID(), sessionId: session.id,
      content: '请用插件处理', pluginIds: ['missing']
    })
    await vi.runAllTimersAsync()
    expect(mocks.createCapabilityTask).not.toHaveBeenCalled()
    expect((await store.listMessages(session.id)).at(-1)).toMatchObject({
      role: 'assistant', status: 'error', finishReason: 'setup_error'
    })
  })

  it('keeps an image and an explicitly selected plugin in the same optional tool reply', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astryve-vision-plugin-'))
    try {
      initArtifactStore(root)
      mocks.preset = { id: 'vision', provider: 'deepseek', model: 'vision-model',
        baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20,
        contextTokens: 16000, capabilities: { imageInput: true, nativeToolCalling: true } }
      mocks.plugins = [{ id: 'test', status: 'ready', enabled: true }]
      mocks.availableTools = [
        { function: { name: 'plugin.test.run' } },
        { function: { name: 'mcp__test__api__search' } }
      ]
      const store = mocks.store as MemoryStore
      const session = await store.createSession('vision plugin')
      await mocks.handlers.get(IPC.message.send)!(event(), {
        clientMessageId: crypto.randomUUID(), sessionId: session.id,
        content: '分析这张图并调用插件', pluginIds: ['test'],
        attachments: [{ id: crypto.randomUUID(), kind: 'image', name: 'test.png',
          contentType: 'image/png', dataRef: 'data:image/png;base64,AA==' }]
      })
      await vi.runAllTimersAsync()
      expect(mocks.createCapabilityTask).toHaveBeenCalledWith(session.id, 42, ['test'])
      await vi.waitFor(() => expect(mocks.runToolCallingLoop).toHaveBeenCalled())
      expect(mocks.runToolCallingLoop.mock.calls[0][0]).toMatchObject({
        allowedToolNames: new Set(['plugin.test.run', 'mcp__test__api__search']),
        requireInitialTool: false,
        model: expect.objectContaining({ vision: true })
      })
      expect(JSON.stringify(mocks.runToolCallingLoop.mock.calls[0][0])).toContain('image_url')
      expect((await store.listMessages(session.id)).at(-1)?.status).toBe('done')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not silently drop an explicitly selected plugin on the legacy browser route', async () => {
    mocks.preset = { id: 'deepseek', provider: 'deepseek', model: 'deepseek-chat',
      baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20, contextTokens: 16000 }
    mocks.plugins = [{ id: 'test', status: 'ready', enabled: true }]
    mocks.availableTools = [
      { function: { name: 'plugin.test.run' } },
      { function: { name: 'mcp__test__api__search' } }
    ]
    const store = mocks.store as MemoryStore
    const session = await store.createSession('browser plugin')
    await mocks.handlers.get(IPC.message.send)!(event(), {
      clientMessageId: crypto.randomUUID(), sessionId: session.id,
      content: '查看浏览器当前页面并调用插件', pluginIds: ['test']
    })
    await vi.runAllTimersAsync()
    expect(mocks.createCapabilityTask).toHaveBeenCalledWith(session.id, 42, ['test'])
    expect(mocks.runToolCallingLoop.mock.calls[0][0]).toMatchObject({ requireInitialTool: true })
    const allowed = (mocks.runToolCallingLoop.mock.calls[0][0] as unknown as {
      allowedToolNames: Set<string>
    }).allowedToolNames
    expect(allowed.has('plugin.test.run')).toBe(true)
    expect(allowed.has('mcp__test__api__search')).toBe(true)
    expect(allowed.has('browser.listTabs')).toBe(true)
    expect(mocks.acquireBrowserLease).toHaveBeenCalledTimes(1)
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
