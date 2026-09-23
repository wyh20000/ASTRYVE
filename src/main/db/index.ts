import { app } from 'electron'
import { join } from 'path'
import type { Session, Message, MessageBlock, Attachment, MessageRole, MessageStatus, GenerationFinishReason } from '@shared/types'
import { MySqlStore, type MySqlConfig } from './mysql'
import { MemoryStore } from './memory'
import { getDbSettings } from '../services/settings'

/** 数据库访问统一接口（repos 之后不感知具体后端） */
export interface DbStore {
  listSessions(): Promise<Session[]>
  getSession(id: string): Promise<Session | null>
  createSession(title: string, projectPath?: string | null): Promise<Session>
  renameSession(id: string, title: string): Promise<Session | null>
  setSessionProjectPath(id: string, projectPath: string | null): Promise<Session | null>
  touchSession(id: string): Promise<Session | null>
  deleteSession(id: string): Promise<void>
  listMessages(sessionId: string): Promise<Message[]>
  insertMessage(input: InsertMessageInput): Promise<Message>
  upsertMessage(msg: Message): Promise<Message>
}

export interface InsertMessageInput {
  id?: string
  sessionId: string
  role: MessageRole
  content: string
  blocks?: MessageBlock[]
  attachments?: Attachment[]
  status?: MessageStatus
  timestamp?: number
  generationId?: string
  revision?: number
  finishReason?: GenerationFinishReason
}

export function defaultMySqlConfig(): MySqlConfig {
  const saved = getDbSettings()
  return {
    host: process.env.MYSQL_HOST ?? saved.host,
    port: Number(process.env.MYSQL_PORT ?? saved.port),
    user: process.env.MYSQL_USER ?? saved.user,
    password: process.env.MYSQL_PASSWORD ?? saved.password,
    database: process.env.MYSQL_DATABASE ?? saved.database
  }
}

let store: DbStore | null = null

/** 初始化并选择后端：优先 MySQL；连不上则回退本地文件持久化（JSON，重启不丢） */
export async function initStore(accountScoped = false): Promise<DbStore> {
  if (store) return store
  if (accountScoped) {
    // The legacy MySQL schema has no account key. Authenticated clients use
    // the account-specific local store until a scoped server schema exists.
    store = new MemoryStore(join(app.getPath('userData'), 'ai-agent-data.json'))
    await recoverInterruptedMessages(store)
    return store
  }
  try {
    store = await MySqlStore.connect(defaultMySqlConfig())
    console.log('[db] connected to MySQL at', process.env.MYSQL_HOST ?? '127.0.0.1')
  } catch (e) {
    console.warn('[db] MySQL unavailable, using local file store (persistent):', String(e))
    store = new MemoryStore(join(app.getPath('userData'), 'ai-agent-data.json'))
  }
  await recoverInterruptedMessages(store)
  return store
}

/** 应用异常退出后，不让历史中的未完成消息永久显示为“生成中”。 */
export async function recoverInterruptedMessages(target: DbStore): Promise<number> {
  let recovered = 0
  for (const session of await target.listSessions()) {
    for (const message of await target.listMessages(session.id)) {
      if (!['pending', 'waiting', 'streaming'].includes(message.status)) continue
      await target.upsertMessage({
        ...message,
        status: 'interrupted',
        revision: (message.revision ?? 0) + 1,
        finishReason: 'app_restarted'
      })
      recovered += 1
    }
  }
  return recovered
}

export function getStore(): DbStore {
  if (!store) throw new Error('Store not initialized')
  return store
}
