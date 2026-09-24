import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  store: undefined as unknown,
  projectEnabled: false,
  browserCapability: null as null | {
    allowedToolNames: (taskId: string) => Set<string>
    isActivated: (taskId: string) => boolean
    mayUseTool: (taskId: string, name: string, args: unknown) => boolean
    observeToolResult: (taskId: string, name: string, args: unknown, result: unknown) => Promise<void>
    setPageChoice: (taskId: string, choose: unknown) => void
    release: (taskId: string) => Promise<void>
  },
  workspaceGrant: null as null | { id: string; rootPath: string },
  plugins: [] as Array<{ id: string; status: string; enabled: boolean }>,
  availableTools: [] as Array<{ function: { name: string } }>,
  screenshotArtifact: null as null | { id: string; taskId: string; callId: string;
    mimeType: 'image/jpeg'; data: string; byteLength: number; expiresAt: number },
  preset: null as null | { id: string; provider: 'deepseek' | 'custom'; model: string; baseUrl: string; apiKey: string;
    contextMessages: number; contextTokens: number; capabilities?: { imageInput: boolean; nativeToolCalling?: boolean } },
  createCapabilityTask: vi.fn(async (sessionId: string, _ownerId: number, pluginIds?: readonly string[]) => ({
    id: `capability-${sessionId}`, workspaceId: `capability:${sessionId}`,
    environment: 'local', pluginIds: [...(pluginIds ?? [])], pluginVersions: {},
    capabilityToolNames: mocks.availableTools.map((tool) => tool.function.name)
  })),
  createProjectTask: vi.fn(async (sessionId: string, _ownerId: number, pluginIds?: readonly string[]) => ({
    id: `project-${sessionId}`, workspaceId: 'workspace-a', environment: 'local',
    pluginIds: [...(pluginIds ?? [])], pluginVersions: {}, capabilityToolNames: []
  })),
  runToolCallingLoop: vi.fn(async (input: { onEvent: (event: unknown) => Promise<void>;
    onToolActivity?: (activity: unknown) => Promise<unknown> }) => {
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
  createProjectTask: mocks.createProjectTask, getPatchWorkspaceService: vi.fn(),
  getBrowserCapability: () => mocks.browserCapability,
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
vi.mock('../services/agent/workspaceManager', () => ({
  getWorkspaceService: () => ({ getGrant: () => mocks.workspaceGrant }),
  restoreSessionWorkspace: async () => mocks.workspaceGrant?.id
}))
vi.mock('../services/agent/skillManager', () => ({ auditSkillUse: vi.fn(),
  resolveSkills: vi.fn(async (request: string) => ({ prompt: '', cleanedRequest: request, skills: [] })) }))
vi.mock('../services/browser/officialChromeBrowserRuntime', () => ({
  acquireOfficialChromeBrowserLease: mocks.acquireBrowserLease
}))
vi.mock('../services/browser/browserTools', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/browser/browserTools')>(),
  consumeBrowserScreenshotArtifact: () => mocks.screenshotArtifact
}))

import { IPC, EVENTS } from '@shared/ipc'
import { MemoryStore } from '../db/memory'
import { SqliteStore } from '../db/sqlite'
import { initArtifactStore } from '../services/artifactStore'
import { configureTrustedIpcSender, setBusinessIpcAvailable } from './validation'
import { buildHistory, registerMessageIpc } from './message'
import { requestUserInput } from '../services/agent/userInput'

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
    mocks.browserCapability = null
    mocks.workspaceGrant = null
    mocks.plugins = []
    mocks.availableTools = []
    mocks.screenshotArtifact = null
    mocks.preset = null
    mocks.streamChat.mockClear()
    mocks.streamDeepSeekSearch.mockClear()
    mocks.createCapabilityTask.mockClear()
    mocks.createProjectTask.mockClear()
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
      requireInitialTool: false, allowedToolNames: new Set(['browser.activate'])
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

  it('does not silently downgrade a work session after its project authorization is lost', async () => {
    mocks.preset = { id: 'deepseek', provider: 'deepseek', model: 'deepseek-chat',
      baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20, contextTokens: 16000 }
    const store = mocks.store as MemoryStore
    const session = await store.createSession('work', 'D:\\project-a', 'workspace-a')
    await mocks.handlers.get(IPC.message.send)!(event(), {
      clientMessageId: crypto.randomUUID(), sessionId: session.id, content: '修改项目代码'
    })
    await vi.runAllTimersAsync()
    expect(mocks.createCapabilityTask).not.toHaveBeenCalled()
    expect(mocks.runToolCallingLoop).not.toHaveBeenCalled()
    expect((await store.listMessages(session.id)).at(-1)).toMatchObject({
      role: 'assistant', status: 'error', content: expect.stringContaining('项目授权已失效')
    })
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
        allowedToolNames: new Set(['plugin.test.run', 'mcp__test__api__search', 'browser.activate']),
        requireInitialTool: false,
        model: expect.objectContaining({ vision: true })
      })
      expect(JSON.stringify(mocks.runToolCallingLoop.mock.calls[0][0])).toContain('image_url')
      expect((await store.listMessages(session.id)).at(-1)?.status).toBe('done')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps Coding tools available for a vision request in an authorized work session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astryve-vision-work-'))
    try {
      initArtifactStore(root)
      mocks.preset = { id: 'vision', provider: 'deepseek', model: 'vision-model',
        baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20,
        contextTokens: 16000, capabilities: { imageInput: true, nativeToolCalling: true } }
      mocks.projectEnabled = true
      mocks.workspaceGrant = { id: 'workspace-a', rootPath: 'D:\\project-a' }
      mocks.availableTools = [{ function: { name: 'workspace.readFile' } }]
      const store = mocks.store as MemoryStore
      const session = await store.createSession('vision work', 'D:\\project-a', 'workspace-a')
      await mocks.handlers.get(IPC.message.send)!(event(), {
        clientMessageId: crypto.randomUUID(), sessionId: session.id,
        content: '结合图片检查项目代码',
        attachments: [{ id: crypto.randomUUID(), kind: 'image', name: 'bug.png',
          contentType: 'image/png', dataRef: 'data:image/png;base64,AA==' }]
      })
      await vi.runAllTimersAsync()
      expect(mocks.createProjectTask).toHaveBeenCalledWith(session.id, 42, undefined)
      expect(mocks.createCapabilityTask).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(mocks.runToolCallingLoop).toHaveBeenCalled())
      expect(mocks.runToolCallingLoop.mock.calls[0][0]).toMatchObject({
        requireInitialTool: true,
        model: expect.objectContaining({ vision: true })
      })
      expect(JSON.stringify(mocks.runToolCallingLoop.mock.calls[0][0])).toContain('image_url')
      expect((await store.listMessages(session.id)).at(-1)?.status).toBe('done')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not let browser wording bypass model activation or drop selected plugins', async () => {
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
    expect(mocks.runToolCallingLoop.mock.calls[0][0]).toMatchObject({ requireInitialTool: false })
    const allowed = (mocks.runToolCallingLoop.mock.calls[0][0] as unknown as {
      allowedToolNames: Set<string>
    }).allowedToolNames
    expect(allowed.has('plugin.test.run')).toBe(true)
    expect(allowed.has('mcp__test__api__search')).toBe(true)
    expect(allowed.has('browser.activate')).toBe(true)
    expect(allowed.has('browser.listTabs')).toBe(false)
    expect(mocks.acquireBrowserLease).not.toHaveBeenCalled()
  })

  it('expands the next tool round only after trusted browser activation state changes', async () => {
    mocks.preset = { id: 'deepseek', provider: 'deepseek', model: 'deepseek-chat',
      baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20, contextTokens: 16000 }
    let activated = false
    const release = vi.fn(async () => undefined)
    mocks.browserCapability = {
      allowedToolNames: () => new Set(activated ? ['browser.inspect'] : []),
      isActivated: () => activated,
      mayUseTool: () => true,
      observeToolResult: async () => undefined,
      setPageChoice: () => undefined,
      release
    }
    const store = mocks.store as MemoryStore
    const session = await store.createSession('dynamic browser')
    await mocks.handlers.get(IPC.message.send)!(event(), {
      clientMessageId: crypto.randomUUID(), sessionId: session.id, content: '看看这个'
    })
    await vi.runAllTimersAsync()
    await vi.waitFor(() => expect(mocks.runToolCallingLoop).toHaveBeenCalled())
    const loop = mocks.runToolCallingLoop.mock.calls[0][0] as unknown as {
      resolveAllowedToolNames: (round: number) => Set<string>
    }
    expect(loop.resolveAllowedToolNames(1)).toEqual(new Set(['browser.activate']))
    activated = true
    expect(loop.resolveAllowedToolNames(2)).toEqual(new Set(['browser.activate', 'browser.inspect']))
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('maps an in-chat page choice to the trusted page ID and hides URL secrets', async () => {
    mocks.preset = { id: 'deepseek', provider: 'deepseek', model: 'deepseek-chat',
      baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20, contextTokens: 16000 }
    const setPageChoice = vi.fn()
    mocks.browserCapability = {
      allowedToolNames: () => new Set(), isActivated: () => false,
      mayUseTool: () => true, observeToolResult: async () => undefined,
      setPageChoice, release: async () => undefined
    }
    const store = mocks.store as MemoryStore
    const session = await store.createSession('choose page')
    await mocks.handlers.get(IPC.message.send)!(event(), {
      clientMessageId: crypto.randomUUID(), sessionId: session.id, content: '查看页面'
    })
    await vi.runAllTimersAsync()
    expect(setPageChoice).toHaveBeenCalledOnce()
    const choose = setPageChoice.mock.calls[0][1] as (
      pages: Array<{ id: string; title: string; url: string }>, signal: AbortSignal
    ) => Promise<string | undefined>
    vi.mocked(requestUserInput).mockResolvedValueOnce({ ok: true, value: {
      answers: [{ id: 'chrome_page', answer: '页面 2 · Second' }]
    } })
    const selected = await choose([
      { id: 'page-1', title: 'First', url: 'https://user:pass@one.test/a?token=secret#private' },
      { id: 'page-2', title: 'Second', url: 'https://two.test/' }
    ], new AbortController().signal)
    expect(selected).toBe('page-2')
    const request = vi.mocked(requestUserInput).mock.calls.at(-1)?.[2]
    expect(JSON.stringify(request)).toContain('https://one.test/a')
    expect(JSON.stringify(request)).not.toMatch(/user|pass|token|secret|private/)
  })

  it('keeps visual input available when a supported model uses Chrome tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astryve-vision-browser-'))
    try {
      initArtifactStore(root)
      mocks.preset = { id: 'vision', provider: 'deepseek', model: 'vision-model',
        baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20,
        contextTokens: 16000, capabilities: { imageInput: true, nativeToolCalling: true } }
      const store = mocks.store as MemoryStore
      const session = await store.createSession('vision browser')
      await mocks.handlers.get(IPC.message.send)!(event(), {
        clientMessageId: crypto.randomUUID(), sessionId: session.id,
        content: '结合这张图查看浏览器页面',
        attachments: [{ id: crypto.randomUUID(), kind: 'image', name: 'reference.png',
          contentType: 'image/png', dataRef: 'data:image/png;base64,AA==' }]
      })
      await vi.runAllTimersAsync()
      await vi.waitFor(() => expect(mocks.runToolCallingLoop).toHaveBeenCalled())
      expect(mocks.acquireBrowserLease).not.toHaveBeenCalled()
      const loop = mocks.runToolCallingLoop.mock.calls[0][0] as unknown as {
        allowedToolNames: Set<string>; model: { vision: boolean }
      }
      expect(loop.allowedToolNames.has('browser.activate')).toBe(true)
      expect(loop.allowedToolNames.has('browser.listTabs')).toBe(false)
      expect(loop.model.vision).toBe(true)
      expect(JSON.stringify(loop)).toContain('image_url')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists a Chrome screenshot before returning its pixels to a vision model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astryve-screenshot-evidence-'))
    try {
      initArtifactStore(root)
      mocks.preset = { id: 'vision', provider: 'deepseek', model: 'vision-model',
        baseUrl: 'https://example.com/v1', apiKey: 'test', contextMessages: 20,
        contextTokens: 16000, capabilities: { imageInput: true, nativeToolCalling: true } }
      mocks.screenshotArtifact = {
        id: 'browser-image-test', taskId: 'capability-test', callId: 'shot-1',
        mimeType: 'image/jpeg', data: Buffer.from('jpeg-bytes').toString('base64'),
        byteLength: 10, expiresAt: Date.now() + 60_000
      }
      let visualEvidence: unknown
      mocks.runToolCallingLoop.mockImplementationOnce(async (input) => {
        visualEvidence = await input.onToolActivity!({
          callId: 'shot-1', toolName: 'browser.screenshot', args: { tabId: '1' },
          status: 'completed', ok: true, result: { artifactId: 'browser-image-test' }
        })
        return { status: 'completed', rounds: 1, messages: [] }
      })
      const store = mocks.store as MemoryStore
      const session = await store.createSession('screenshot')
      await mocks.handlers.get(IPC.message.send)!(event(), {
        clientMessageId: crypto.randomUUID(), sessionId: session.id, content: '截图并分析'
      })
      await vi.runAllTimersAsync()
      await vi.waitFor(() => expect(visualEvidence).toBeDefined())
      expect(visualEvidence).toMatchObject({ role: 'user', content: [
        expect.objectContaining({ type: 'text' }),
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${mocks.screenshotArtifact.data}` } }
      ] })
      const reply = (await store.listMessages(session.id)).at(-1)
      expect(reply?.attachments?.[0]?.dataRef).toMatch(/^artifact:/)
      expect(reply?.blocks?.some((block) => block.kind === 'image')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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
