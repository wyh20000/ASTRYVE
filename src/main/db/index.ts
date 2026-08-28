import type { Session, Message, MessageBlock, MessageRole, MessageStatus } from '@shared/types'
import { MySqlStore, type MySqlConfig } from './mysql'
import { MemoryStore } from './memory'

/** 数据库访问统一接口（repos 之后不感知具体后端） */
export interface DbStore {
  listSessions(): Promise<Session[]>
  getSession(id: string): Promise<Session | null>
  createSession(title: string, projectPath?: string | null): Promise<Session>
  renameSession(id: string, title: string): Promise<Session | null>
  touchSession(id: string): Promise<Session | null>
  deleteSession(id: string): Promise<void>
  listMessages(sessionId: string): Promise<Message[]>
  insertMessage(input: {
    id?: string
    sessionId: string
    role: MessageRole
    content: string
    blocks?: MessageBlock[]
    status?: MessageStatus
    timestamp?: number
  }): Promise<Message>
  upsertMessage(msg: Message): Promise<Message>
}

export interface InsertMessageInput {
  id?: string
  sessionId: string
  role: MessageRole
  content: string
  blocks?: MessageBlock[]
  status?: MessageStatus
  timestamp?: number
}

export function defaultMySqlConfig(): MySqlConfig {
  return {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'ai_agent'
  }
}

let store: DbStore | null = null

/** 初始化并选择后端：优先 MySQL，连不上则回退内存（应用仍可运行） */
export async function initStore(): Promise<DbStore> {
  if (store) return store
  try {
    store = await MySqlStore.connect(defaultMySqlConfig())
    console.log('[db] connected to MySQL at', process.env.MYSQL_HOST ?? '127.0.0.1')
  } catch (e) {
    console.warn('[db] MySQL unavailable, falling back to in-memory store:', String(e))
    store = new MemoryStore()
  }
  return store
}

export function getStore(): DbStore {
  if (!store) throw new Error('Store not initialized')
  return store
}
