import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  spawn: vi.fn(),
  activate: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
    mocks.handlers.set(name, handler)
  } }
}))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../db', () => ({ getStore: () => ({ getSession: async (id: string) => ({
  id, kind: 'work', workspaceId: 'workspace-1', projectPath: process.cwd()
}) }) }))
vi.mock('../services/agent/workspaceManager', () => ({
  getSessionWorkspaceId: () => 'workspace-1',
  sameProjectPath: (left: string, right: string) => left === right,
  getWorkspaceService: () => ({
    activate: mocks.activate,
    getGrant: () => ({ id: 'workspace-1', rootPath: process.cwd(), realRootPath: process.cwd() })
  })
}))

import { IPC } from '@shared/ipc'
import { closeAllTerminals, closeWorkspaceTerminals, registerTerminalIpc } from './terminal'
import { configureTrustedIpcSender, setBusinessIpcAvailable } from './validation'

function event(): unknown {
  const frame = { url: 'file:///D:/app/index.html' }
  const sender = new EventEmitter() as EventEmitter & Record<string, unknown>
  sender.id = 42
  sender.mainFrame = frame
  sender.getURL = () => frame.url
  sender.isDestroyed = () => false
  sender.send = vi.fn()
  return { senderFrame: frame, sender }
}

describe('terminal authentication lifecycle', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.spawn.mockReset()
    mocks.activate.mockReset()
    mocks.activate.mockResolvedValue(undefined)
    configureTrustedIpcSender('file:///D:/app/index.html')
    setBusinessIpcAvailable(true)
    registerTerminalIpc()
  })

  it('closes a running terminal immediately when the account locks', async () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
    const inputWrite = vi.fn()
    child.stdin = { write: inputWrite }
    child.kill = vi.fn()
    mocks.spawn.mockReturnValue(child)
    const open = mocks.handlers.get(IPC.terminal.open)!
    const result = await open(event(), crypto.randomUUID()) as { data?: { id: string } }
    expect(result.data?.id).toBeTruthy()

    setBusinessIpcAvailable(false)
    closeAllTerminals()
    expect(child.kill).toHaveBeenCalledOnce()
    const write = mocks.handlers.get(IPC.terminal.write)!
    const denied = write(event(), result.data!.id, 'echo secret') as { ok: boolean }
    expect(denied.ok).toBe(false)
    expect(inputWrite).not.toHaveBeenCalled()
  })

  it('does not spawn after authentication is revoked during workspace activation', async () => {
    let resolveActivation!: () => void
    mocks.activate.mockImplementation(() => new Promise<undefined>((resolve) => {
      resolveActivation = () => resolve(undefined)
    }))
    const open = mocks.handlers.get(IPC.terminal.open)!
    const pending = open(event(), crypto.randomUUID()) as Promise<{ ok: boolean }>
    await Promise.resolve()
    setBusinessIpcAvailable(false)
    resolveActivation()
    expect((await pending).ok).toBe(false)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('closes an open terminal when its project authorization is revoked', async () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
    child.stdin = { write: vi.fn() }
    child.kill = vi.fn()
    mocks.spawn.mockReturnValue(child)
    const opened = await mocks.handlers.get(IPC.terminal.open)!(event(), crypto.randomUUID()) as { data: { id: string } }
    closeWorkspaceTerminals('workspace-1')
    expect(child.kill).toHaveBeenCalledOnce()
    expect((mocks.handlers.get(IPC.terminal.write)!(event(), opened.data.id, 'echo test') as { ok: boolean }).ok).toBe(false)
  })
})
