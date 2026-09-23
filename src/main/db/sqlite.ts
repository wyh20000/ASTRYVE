import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Attachment, GenerationFinishReason, Message, MessageBlock, MessageCursor, MessageRole, MessageStatus, Session, TurnEnvelope } from '@shared/types'
import { getArtifactStore, isArtifactRef } from '../services/artifactStore'
import type { DbStore, InsertMessageInput } from './index'

interface Statement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

interface Database {
  exec(sql: string): void
  prepare(sql: string): Statement
  close(): void
}

const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => Database }

interface SessionRow extends Record<string, unknown> {
  id: string
  title: string
  kind: string | null
  workspace_id: string | null
  project_path: string | null
  pinned: number
  created_at: number
  updated_at: number
}

interface MessageRow extends Record<string, unknown> {
  id: string
  session_id: string
  role: string
  content: string
  blocks: string | null
  attachments: string | null
  status: string
  timestamp: number
  generation_id: string | null
  revision: number
  finish_reason: string | null
  turn_envelope: string | null
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id, title: row.title, kind: row.kind === 'work' ? 'work' : 'chat',
    workspaceId: row.workspace_id, projectPath: row.project_path,
    pinned: !!row.pinned, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at)
  }
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id, sessionId: row.session_id, role: row.role as MessageRole,
    content: row.content, blocks: row.blocks ? JSON.parse(row.blocks) as MessageBlock[] : undefined,
    attachments: row.attachments ? JSON.parse(row.attachments) as Attachment[] : undefined,
    status: row.status as MessageStatus, timestamp: Number(row.timestamp),
    generationId: row.generation_id ?? undefined, revision: Number(row.revision),
    finishReason: (row.finish_reason as GenerationFinishReason | null) ?? undefined,
    turn: row.turn_envelope ? JSON.parse(row.turn_envelope) as TurnEnvelope : undefined
  }
}

/** Incremental account-local store. Image bytes live in ArtifactStore, never in SQLite rows. */
export class SqliteStore implements DbStore {
  private constructor(private readonly db: Database) {}

  static async open(path: string, legacyJsonPath?: string): Promise<SqliteStore> {
    mkdirSync(dirname(path), { recursive: true })
    const db = new DatabaseSync(path)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000')
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'chat',
        workspace_id TEXT, project_path TEXT, pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_updated ON sessions(updated_at DESC);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, blocks TEXT, attachments TEXT,
        status TEXT NOT NULL, timestamp INTEGER NOT NULL, generation_id TEXT,
        revision INTEGER NOT NULL DEFAULT 0, finish_reason TEXT, turn_envelope TEXT
      );
      CREATE INDEX IF NOT EXISTS messages_session_time ON messages(session_id, timestamp, id);
      CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
    if ((!sessionColumns.some((column) => column.name === 'kind') ||
        !sessionColumns.some((column) => column.name === 'workspace_id')) &&
        path !== ':memory:' && !existsSync(`${path}.pre-work-chat.bak`)) {
      const backupPath = `${path}.pre-work-chat.bak`.replace(/'/g, "''")
      db.exec(`VACUUM INTO '${backupPath}'`)
    }
    if (!sessionColumns.some((column) => column.name === 'kind')) {
      db.exec("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'")
    }
    if (!sessionColumns.some((column) => column.name === 'workspace_id')) {
      db.exec('ALTER TABLE sessions ADD COLUMN workspace_id TEXT')
    }
    db.exec("UPDATE sessions SET kind = 'work' WHERE project_path IS NOT NULL AND kind = 'chat'")
    const store = new SqliteStore(db)
    if (legacyJsonPath && existsSync(legacyJsonPath) &&
        !db.prepare("SELECT value FROM store_meta WHERE key = 'legacy_json_imported'").get()) {
      await store.importLegacyJson(legacyJsonPath)
    }
    return store
  }

  close(): void { this.db.close() }

  private async importLegacyJson(path: string): Promise<void> {
    const legacy = JSON.parse(readFileSync(path, 'utf8')) as { sessions?: Session[]; messages?: Message[] }
    for (const session of legacy.sessions ?? []) {
      this.db.prepare(`INSERT OR IGNORE INTO sessions
        (id, title, kind, workspace_id, project_path, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        session.id, session.title, session.projectPath ? 'work' : 'chat', session.workspaceId ?? null,
        session.projectPath ?? null, session.pinned ? 1 : 0,
        session.createdAt, session.updatedAt
      )
    }
    for (const message of legacy.messages ?? []) {
      if (!(await this.getSession(message.sessionId))) continue
      if (this.db.prepare('SELECT id FROM messages WHERE id = ?').get(message.id)) continue
      await this.upsertMessage(message)
    }
    this.db.prepare("INSERT OR REPLACE INTO store_meta (key, value) VALUES ('legacy_json_imported', ?)").run(
      new Date().toISOString()
    )
  }

  async listSessions(): Promise<Session[]> {
    return (this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[]).map(toSession)
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
    return row ? toSession(row) : null
  }

  async createSession(title: string, projectPath: string | null = null, workspaceId: string | null = null): Promise<Session> {
    const now = Date.now()
    const session: Session = {
      id: randomUUID(), title, kind: projectPath ? 'work' : 'chat', workspaceId,
      projectPath, pinned: false, createdAt: now, updatedAt: now
    }
    this.db.prepare(`INSERT INTO sessions (id, title, kind, workspace_id, project_path, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)`).run(session.id, title, session.kind, workspaceId, projectPath, now, now)
    return session
  }

  async renameSession(id: string, title: string): Promise<Session | null> {
    this.db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id)
    return this.getSession(id)
  }

  async setSessionProjectPath(id: string, projectPath: string | null): Promise<Session | null> {
    this.db.prepare('UPDATE sessions SET project_path = ?, kind = ?, workspace_id = NULL, updated_at = ? WHERE id = ?')
      .run(projectPath, projectPath ? 'work' : 'chat', Date.now(), id)
    return this.getSession(id)
  }

  async touchSession(id: string): Promise<Session | null> {
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), id)
    return this.getSession(id)
  }

  async deleteSession(id: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    return (this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp, id')
      .all(sessionId) as MessageRow[]).map(toMessage)
  }

  async listMessagesPage(sessionId: string, before?: MessageCursor, limit = 100): Promise<Message[]> {
    const rows = before
      ? this.db.prepare(`SELECT * FROM messages WHERE session_id = ? AND
          (timestamp < ? OR (timestamp = ? AND id < ?)) ORDER BY timestamp DESC, id DESC LIMIT ?`)
        .all(sessionId, before.timestamp, before.timestamp, before.id, limit)
      : this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?')
        .all(sessionId, limit)
    return (rows as MessageRow[]).reverse().map(toMessage)
  }

  private async storedAttachments(attachments?: Attachment[]): Promise<Attachment[] | undefined> {
    if (!attachments?.length) return attachments
    return Promise.all(attachments.map(async (attachment) => {
      if (!['image', 'file'].includes(attachment.kind) || isArtifactRef(attachment.dataRef)) return attachment
      if (!attachment.dataRef.startsWith('data:')) return attachment
      const source = typeof attachment.meta?.source === 'string' ? attachment.meta.source : 'user'
      const stored = await getArtifactStore().putDataUrl(attachment.dataRef, source)
      return {
        ...attachment, dataRef: stored.ref, contentType: stored.mime,
        meta: { ...attachment.meta, hash: stored.hash, sizeBytes: stored.sizeBytes, source }
      }
    }))
  }

  async insertMessage(input: InsertMessageInput): Promise<Message> {
    const message: Message = {
      id: input.id ?? randomUUID(), sessionId: input.sessionId, role: input.role,
      content: input.content, blocks: input.blocks, attachments: input.attachments,
      status: input.status ?? 'done', timestamp: input.timestamp ?? Date.now(),
      generationId: input.generationId, revision: input.revision,
      finishReason: input.finishReason, turn: input.turn
    }
    await this.writeMessage(message, true)
    return message
  }

  async upsertMessage(message: Message): Promise<Message> {
    await this.writeMessage(message, false)
    return message
  }

  private async writeMessage(message: Message, insertOnly: boolean): Promise<void> {
    const attachments = await this.storedAttachments(message.attachments)
    const sql = `INSERT INTO messages
      (id, session_id, role, content, blocks, attachments, status, timestamp, generation_id, revision, finish_reason, turn_envelope)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    const params = [
      message.id, message.sessionId, message.role, message.content,
      message.blocks ? JSON.stringify(message.blocks) : null,
      attachments ? JSON.stringify(attachments) : null,
      message.status, message.timestamp, message.generationId ?? null,
      message.revision ?? 0, message.finishReason ?? null,
      message.turn ? JSON.stringify(message.turn) : null
    ]
    if (insertOnly) {
      this.db.prepare(sql).run(...params)
      return
    }
    this.db.prepare(`${sql} ON CONFLICT(id) DO UPDATE SET
      content = excluded.content, blocks = excluded.blocks, attachments = excluded.attachments,
      status = excluded.status, timestamp = excluded.timestamp, generation_id = excluded.generation_id,
      revision = excluded.revision, finish_reason = excluded.finish_reason,
      turn_envelope = excluded.turn_envelope
      WHERE excluded.revision >= messages.revision`).run(...params)
  }
}
