import { dirname } from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import type { Session, Message } from '@shared/types'
import type { DbStore, InsertMessageInput } from './index'

interface FileShape {
  sessions: Session[]
  messages: Message[]
}

/** 本地文件持久化后端：当 MySQL 不可用时兜底，数据写到用户数据目录，重启不丢 */
export class MemoryStore implements DbStore {
  private sessions = new Map<string, Session>()
  private messages = new Map<string, Message[]>()
  private filePath: string | null = null
  private persistChain: Promise<void> = Promise.resolve()

  constructor(filePath?: string) {
    this.filePath = filePath ?? null
    if (this.filePath) this.load()
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath!)) {
        const data = JSON.parse(fs.readFileSync(this.filePath!, 'utf-8')) as FileShape
        for (const s of data.sessions ?? []) this.sessions.set(s.id, s)
        for (const m of data.messages ?? []) {
          const list = this.messages.get(m.sessionId) ?? []
          list.push(m)
          this.messages.set(m.sessionId, list)
        }
      }
    } catch (e) {
      console.warn('[db] load file failed:', e)
    }
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return
    const target = this.filePath
    const payload = JSON.stringify(
      {
        sessions: [...this.sessions.values()],
        messages: [...this.messages.values()].flat()
      } satisfies FileShape,
      null,
      2
    )
    const write = async (): Promise<void> => {
      const temp = `${target}.${process.pid}.tmp`
      try {
        await fs.promises.mkdir(dirname(target), { recursive: true })
        await fs.promises.writeFile(temp, payload, { encoding: 'utf-8', mode: 0o600 })
        await fs.promises.rename(temp, target)
      } catch (e) {
        await fs.promises.rm(temp, { force: true }).catch(() => undefined)
        console.warn('[db] save file failed:', e)
      }
    }
    this.persistChain = this.persistChain.then(write, write)
    await this.persistChain
  }

  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getSession(id: string): Promise<Session | null> {
    return this.sessions.get(id) ?? null
  }

  async createSession(title: string, projectPath: string | null = null): Promise<Session> {
    const now = Date.now()
    const s: Session = {
      id: randomUUID(),
      title,
      projectPath,
      pinned: false,
      createdAt: now,
      updatedAt: now
    }
    this.sessions.set(s.id, s)
    await this.persist()
    return s
  }

  async renameSession(id: string, title: string): Promise<Session | null> {
    const s = this.sessions.get(id)
    if (!s) return null
    s.title = title
    s.updatedAt = Date.now()
    await this.persist()
    return s
  }

  async setSessionProjectPath(id: string, projectPath: string | null): Promise<Session | null> {
    const session = this.sessions.get(id)
    if (!session) return null
    session.projectPath = projectPath
    session.updatedAt = Date.now()
    await this.persist()
    return session
  }

  async touchSession(id: string): Promise<Session | null> {
    const s = this.sessions.get(id)
    if (!s) return null
    s.updatedAt = Date.now()
    await this.persist()
    return s
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id)
    this.messages.delete(id)
    await this.persist()
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    return [...(this.messages.get(sessionId) ?? [])].sort((a, b) => a.timestamp - b.timestamp)
  }

  async insertMessage(input: InsertMessageInput): Promise<Message> {
    const m: Message = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      blocks: input.blocks,
      attachments: input.attachments,
      status: input.status ?? 'done',
      timestamp: input.timestamp ?? Date.now()
    }
    const list = this.messages.get(m.sessionId) ?? []
    list.push(m)
    this.messages.set(m.sessionId, list)
    await this.persist()
    return m
  }

  async upsertMessage(msg: Message): Promise<Message> {
    const list = this.messages.get(msg.sessionId) ?? []
    const idx = list.findIndex((m) => m.id === msg.id)
    if (idx >= 0) list[idx] = msg
    else list.push(msg)
    this.messages.set(msg.sessionId, list)
    await this.persist()
    return msg
  }
}
