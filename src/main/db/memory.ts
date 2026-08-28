import { randomUUID } from 'crypto'
import type { Session, Message } from '@shared/types'
import type { DbStore, InsertMessageInput } from './index'

/** 内存后端：当 MySQL 不可用时的兜底，P1 演示/验证用 */
export class MemoryStore implements DbStore {
  private sessions = new Map<string, Session>()
  private messages = new Map<string, Message[]>()

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
    return s
  }

  async renameSession(id: string, title: string): Promise<Session | null> {
    const s = this.sessions.get(id)
    if (!s) return null
    s.title = title
    s.updatedAt = Date.now()
    return s
  }

  async touchSession(id: string): Promise<Session | null> {
    const s = this.sessions.get(id)
    if (!s) return null
    s.updatedAt = Date.now()
    return s
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id)
    this.messages.delete(id)
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
      status: input.status ?? 'done',
      timestamp: input.timestamp ?? Date.now()
    }
    const list = this.messages.get(m.sessionId) ?? []
    list.push(m)
    this.messages.set(m.sessionId, list)
    return m
  }

  async upsertMessage(msg: Message): Promise<Message> {
    const list = this.messages.get(msg.sessionId) ?? []
    const idx = list.findIndex((m) => m.id === msg.id)
    if (idx >= 0) list[idx] = msg
    else list.push(msg)
    this.messages.set(msg.sessionId, list)
    return msg
  }
}
