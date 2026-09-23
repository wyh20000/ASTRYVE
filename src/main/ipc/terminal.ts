import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { ipcMain, type WebContents } from 'electron'
import { IPC, EVENTS } from '@shared/ipc'
import { getSessionWorkspaceId, getWorkspaceService } from '../services/agent/workspaceManager'
import { getStore } from '../db'
import { isWorkSessionForWorkspace } from '../services/agent/sessionScope'
import { assertTrustedIpcSender, validateSessionId } from './validation'
import { err, ok } from './result'

interface TerminalSession {
  id: string
  workspaceId: string
  ownerId: number
  child: ChildProcessWithoutNullStreams
}

const terminals = new Map<string, TerminalSession>()

export function registerTerminalIpc(): void {
  ipcMain.handle(IPC.terminal.open, async (event, rawSessionId?: string) => {
    try {
      assertTrustedIpcSender(event)
      const sessionId = validateSessionId(rawSessionId)
      const session = await getStore().getSession(sessionId)
      const workspaceId = getSessionWorkspaceId(sessionId)
      const grant = workspaceId ? getWorkspaceService().getGrant(workspaceId) : undefined
      if (!workspaceId || !isWorkSessionForWorkspace(session, grant, workspaceId)) {
        return err('SESSION_SCOPE', '仅已绑定项目的工作会话可打开终端')
      }
      await getWorkspaceService().activate(workspaceId)
      // Authentication may have been revoked while workspace activation awaited I/O.
      assertTrustedIpcSender(event)
      const refreshedGrant = getWorkspaceService().getGrant(workspaceId)
      if (!isWorkSessionForWorkspace(session, refreshedGrant, workspaceId)) return err('NO_WORKSPACE', '工作区授权已失效')
      closeOwnerTerminals(event.sender.id)
      const executable = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh')
      const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['-i']
      const child = spawn(executable, args, {
        cwd: refreshedGrant!.realRootPath, shell: false, windowsHide: true,
        env: terminalEnvironment()
      })
      const terminal: TerminalSession = { id: randomUUID(), workspaceId, ownerId: event.sender.id, child }
      terminals.set(terminal.id, terminal)
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (text: string) => emit(event.sender, terminal, 'stdout', text))
      child.stderr.on('data', (text: string) => emit(event.sender, terminal, 'stderr', text))
      child.once('close', () => terminals.delete(terminal.id))
      child.once('error', (error) => emit(event.sender, terminal, 'stderr', `${error.message}\n`))
      event.sender.once('destroyed', () => closeOwnerTerminals(event.sender.id))
      return ok({ id: terminal.id, workspaceId, shell: executable })
    } catch (error) {
      return err('TERMINAL_OPEN_FAILED', error instanceof Error ? error.message : '终端启动失败')
    }
  })

  ipcMain.handle(IPC.terminal.write, (event, terminalId?: string, text?: string) => {
    try {
      assertTrustedIpcSender(event)
      const terminal = requireOwned(terminalId, event.sender.id)
      if (typeof text !== 'string' || !text || text.length > 8192 || text.includes('\0')) {
        return err('INVALID_INPUT', '终端输入无效')
      }
      terminal.child.stdin.write(text)
      return ok({ written: true })
    } catch (error) {
      return err('TERMINAL_WRITE_FAILED', error instanceof Error ? error.message : '终端输入失败')
    }
  })

  ipcMain.handle(IPC.terminal.close, (event, terminalId?: string) => {
    try {
      assertTrustedIpcSender(event)
      const terminal = requireOwned(terminalId, event.sender.id)
      terminals.delete(terminal.id)
      terminal.child.kill()
      return ok({ closed: true })
    } catch (error) {
      return err('TERMINAL_CLOSE_FAILED', error instanceof Error ? error.message : '终端关闭失败')
    }
  })
}

function emit(owner: WebContents, terminal: TerminalSession, stream: 'stdout' | 'stderr', text: string): void {
  if (!owner.isDestroyed() && terminals.has(terminal.id)) {
    owner.send(EVENTS.terminalOutput, { terminalId: terminal.id, stream, text })
  }
}

function requireOwned(id: unknown, ownerId: number): TerminalSession {
  if (typeof id !== 'string') throw new Error('终端标识无效')
  const terminal = terminals.get(id)
  if (!terminal || terminal.ownerId !== ownerId) throw new Error('终端不存在或不属于当前窗口')
  return terminal
}

function closeOwnerTerminals(ownerId: number): void {
  for (const terminal of terminals.values()) {
    if (terminal.ownerId !== ownerId) continue
    terminals.delete(terminal.id)
    terminal.child.kill()
  }
}

export function closeAllTerminals(): void {
  for (const terminal of terminals.values()) {
    terminals.delete(terminal.id)
    terminal.child.kill()
  }
}

function terminalEnvironment(): NodeJS.ProcessEnv {
  const names = process.platform === 'win32'
    ? ['Path', 'PATH', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'PATHEXT']
    : ['PATH', 'TERM', 'LANG', 'LC_ALL', 'TMPDIR']
  return Object.fromEntries(names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]))
}
