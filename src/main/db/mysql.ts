import { randomUUID } from 'crypto'
import mysql, { type Pool } from 'mysql2/promise'
import type { Session, Message, MessageBlock, Attachment, MessageRole, MessageStatus } from '@shared/types'
import type { DbStore, InsertMessageInput } from './index'

export interface MySqlConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
}

interface SessionRow {
  id: string
  title: string
  project_path: string | null
  pinned: number | boolean
  created_at: number | string
  updated_at: number | string
}

interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  blocks: string | null
  attachments: string | null
  status: string
  timestamp: number | string
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

function toSession(r: SessionRow): Session {
  return {
    id: r.id,
    title: r.title,
    projectPath: r.project_path,
    pinned: !!r.pinned,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at)
  }
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role as MessageRole,
    content: r.content,
    blocks: r.blocks ? (JSON.parse(r.blocks) as MessageBlock[]) : undefined,
    attachments: r.attachments ? (JSON.parse(r.attachments) as Attachment[]) : undefined,
    status: r.status as MessageStatus,
    timestamp: num(r.timestamp)
  }
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sessions (
     id VARCHAR(64) PRIMARY KEY,
     title VARCHAR(512) NOT NULL,
     project_path VARCHAR(512),
     pinned TINYINT(1) NOT NULL DEFAULT 0,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL,
     INDEX idx_sessions_updated (updated_at DESC)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS messages (
     id VARCHAR(64) PRIMARY KEY,
     session_id VARCHAR(64) NOT NULL,
     role VARCHAR(16) NOT NULL,
     content MEDIUMTEXT NOT NULL,
     blocks MEDIUMTEXT,
     attachments MEDIUMTEXT,
     status VARCHAR(16) NOT NULL DEFAULT 'done',
     timestamp BIGINT NOT NULL,
     INDEX idx_messages_session_time (session_id, timestamp),
     CONSTRAINT fk_messages_session FOREIGN KEY (session_id)
       REFERENCES sessions(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
]

export class MySqlStore implements DbStore {
  private readonly pool: Pool
  private constructor(pool: Pool) {
    this.pool = pool
  }

  /** 连接并初始化：确保数据库存在、创建表结构。失败则抛出（由上层回退内存）。 */
  static async connect(cfg: MySqlConfig): Promise<MySqlStore> {
    if (!/^[A-Za-z0-9_]+$/.test(cfg.database)) {
      throw new Error('MySQL database name may only contain letters, numbers, and underscores')
    }
    const admin = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      supportBigNumbers: true
    })
    try {
      await admin.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(cfg.database)}`)
    } finally {
      await admin.end()
    }

    const pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      supportBigNumbers: true,
      bigNumberStrings: false,
      waitForConnections: true,
      connectionLimit: 5
    })

    for (const stmt of SCHEMA_STATEMENTS) {
      await pool.query(stmt)
    }
    // 迁移：老库补 attachments 列（重复列错误忽略）
    try {
      await pool.query('ALTER TABLE messages ADD COLUMN attachments MEDIUMTEXT NULL')
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (code !== 'ER_DUP_FIELDNAME') throw error
    }
    await pool.query('SELECT 1')
    return new MySqlStore(pool)
  }

  async listSessions(): Promise<Session[]> {
    const [rows] = await this.pool.query(
      'SELECT * FROM sessions ORDER BY updated_at DESC'
    )
    return (rows as SessionRow[]).map(toSession)
  }

  async getSession(id: string): Promise<Session | null> {
    const [rows] = await this.pool.query('SELECT * FROM sessions WHERE id = ?', [id])
    const list = rows as SessionRow[]
    return list.length ? toSession(list[0]) : null
  }

  async createSession(title: string, projectPath: string | null = null): Promise<Session> {
    const id = randomUUID()
    const now = Date.now()
    await this.pool.query(
      `INSERT INTO sessions (id, title, project_path, pinned, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      [id, title, projectPath, now, now]
    )
    return (await this.getSession(id))!
  }

  async renameSession(id: string, title: string): Promise<Session | null> {
    await this.pool.query('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', [
      title,
      Date.now(),
      id
    ])
    return this.getSession(id)
  }

  async touchSession(id: string): Promise<Session | null> {
    await this.pool.query('UPDATE sessions SET updated_at = ? WHERE id = ?', [Date.now(), id])
    return this.getSession(id)
  }

  async deleteSession(id: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE id = ?', [id])
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    const [rows] = await this.pool.query(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC',
      [sessionId]
    )
    return (rows as MessageRow[]).map(toMessage)
  }

  async insertMessage(input: InsertMessageInput): Promise<Message> {
    const id = input.id ?? randomUUID()
    const timestamp = input.timestamp ?? Date.now()
    const m: Message = {
      id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      blocks: input.blocks,
      attachments: input.attachments,
      status: input.status ?? 'done',
      timestamp
    }
    await this.pool.query(
      `INSERT INTO messages (id, session_id, role, content, blocks, attachments, status, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        m.sessionId,
        m.role,
        m.content,
        m.blocks ? JSON.stringify(m.blocks) : null,
        m.attachments ? JSON.stringify(m.attachments) : null,
        m.status,
        timestamp
      ]
    )
    return m
  }

  async upsertMessage(msg: Message): Promise<Message> {
    await this.pool.query(
      `INSERT INTO messages (id, session_id, role, content, blocks, attachments, status, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         content = VALUES(content),
         blocks = VALUES(blocks),
         attachments = VALUES(attachments),
         status = VALUES(status),
         timestamp = VALUES(timestamp)`,
      [
        msg.id,
        msg.sessionId,
        msg.role,
        msg.content,
        msg.blocks ? JSON.stringify(msg.blocks) : null,
        msg.attachments ? JSON.stringify(msg.attachments) : null,
        msg.status,
        msg.timestamp
      ]
    )
    return msg
  }
}
