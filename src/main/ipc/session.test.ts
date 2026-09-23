import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  store: undefined as unknown,
  activate: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111',
    name: 'project-a', displayPath: 'D:\\project-a', createdAt: 1, lastOpenedAt: 1 })),
  bind: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
  mocks.handlers.set(name, handler)
} } }))
vi.mock('../db', () => ({ getStore: () => mocks.store, collectOrphanArtifacts: vi.fn(async () => 0) }))
vi.mock('../services/agent/workspaceManager', () => ({
  getWorkspaceService: () => ({ activate: mocks.activate }),
  activateSessionWorkspace: mocks.bind, clearSessionWorkspace: vi.fn()
}))
vi.mock('../services/generationTasks', () => ({ cancelGeneration: vi.fn() }))
vi.mock('../services/agent/taskRuntimeManager', () => ({ cancelTasksForSession: vi.fn() }))

import { IPC } from '@shared/ipc'
import { MemoryStore } from '../db/memory'
import { configureTrustedIpcSender, setBusinessIpcAvailable } from './validation'
import { registerSessionIpc } from './session'

function event(): unknown {
  const frame = { url: 'file:///D:/app/index.html' }
  return { senderFrame: frame, sender: { mainFrame: frame, getURL: () => frame.url } }
}

describe('session creation scope', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.store = new MemoryStore()
    mocks.activate.mockClear()
    mocks.bind.mockClear()
    configureTrustedIpcSender('file:///D:/app/index.html')
    setBusinessIpcAvailable(true)
    registerSessionIpc()
  })

  it('creates chat without project and work only from a trusted workspace ID', async () => {
    const create = mocks.handlers.get(IPC.session.create)!
    const chat = await create(event(), { kind: 'chat', title: '普通' }) as { ok: boolean; data: { id: string; kind: string; projectPath: string | null } }
    const work = await create(event(), { kind: 'work', workspaceId, title: '项目' }) as { ok: boolean; data: { id: string; kind: string; workspaceId: string; projectPath: string } }
    expect(chat.data).toMatchObject({ kind: 'chat', projectPath: null })
    expect(work.data).toMatchObject({ kind: 'work', workspaceId, projectPath: 'D:\\project-a' })
    expect(mocks.bind).toHaveBeenCalledWith(work.data.id, workspaceId)
    expect(await create(event(), { kind: 'chat', workspaceId })).toMatchObject({ ok: false })
    expect(await create(event(), { kind: 'work' })).toMatchObject({ ok: false })
    expect(await create(event(), { projectPath: 'D:\\project-a' })).toMatchObject({ ok: false })
  })

  it('never reuses a blank chat for a work project or across projects', async () => {
    const create = mocks.handlers.get(IPC.session.create)!
    const chat = await create(event(), { kind: 'chat' }) as { data: { id: string } }
    const work = await create(event(), { kind: 'work', workspaceId }) as { data: { id: string } }
    const again = await create(event(), { kind: 'work', workspaceId }) as { data: { id: string } }
    expect(work.data.id).not.toBe(chat.data.id)
    expect(again.data.id).toBe(work.data.id)
  })
})
