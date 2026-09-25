import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import { MySqlStore } from './mysql'

const enabled = process.env.AIAGENT_LIVE_MYSQL_TEST === '1'
const restoredDatabase = process.env.AIAGENT_3A_RESTORED_DB
const database = `aiagent_3a_accept_${process.pid}_${Date.now()}`
const config = {
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD ?? '',
  database
}
const adminConfig = { host: config.host, port: config.port, user: config.user, password: config.password }

describe.skipIf(!enabled)('real MySQL legacy migration (isolated database)', () => {
  beforeAll(async () => {
    const admin = await mysql.createConnection(adminConfig)
    try {
      await admin.query(`CREATE DATABASE ${mysql.escapeId(database)}`)
      await admin.query(`USE ${mysql.escapeId(database)}`)
      await admin.query(`CREATE TABLE sessions (
        id VARCHAR(64) PRIMARY KEY, title VARCHAR(512) NOT NULL,
        project_path VARCHAR(512), pinned TINYINT(1) NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
      await admin.query(`CREATE TABLE messages (
        id VARCHAR(64) PRIMARY KEY, session_id VARCHAR(64) NOT NULL,
        role VARCHAR(16) NOT NULL, content MEDIUMTEXT NOT NULL,
        blocks MEDIUMTEXT, status VARCHAR(16) NOT NULL DEFAULT 'done',
        timestamp BIGINT NOT NULL,
        CONSTRAINT fk_messages_session FOREIGN KEY (session_id)
          REFERENCES sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
      await admin.query(`INSERT INTO sessions (id, title, project_path, created_at, updated_at)
        VALUES (?, ?, ?, 1, 3), (?, ?, NULL, 2, 4)`,
      ['legacy-work', '旧项目', 'D:\\old-project', 'legacy-chat', '旧对话'])
      await admin.query(`INSERT INTO messages (id, session_id, role, content, timestamp)
        VALUES ('legacy-work-message', 'legacy-work', 'user', '项目历史仍在', 5),
               ('legacy-chat-message', 'legacy-chat', 'assistant', '普通历史仍在', 6)`)
    } finally {
      await admin.end()
    }
  })

  afterAll(async () => {
    // This exact database is created by this test and contains only synthetic fixture data.
    if (!/^aiagent_3a_accept_\d+_\d+$/.test(database)) return
    const admin = await mysql.createConnection(adminConfig)
    try { await admin.query(`DROP DATABASE ${mysql.escapeId(database)}`) }
    finally { await admin.end() }
  })

  it('preserves history and identity across repeated migrations', async () => {
    for (let pass = 0; pass < 2; pass++) {
      const store = await MySqlStore.connect(config)
      const sessions = await store.listSessions()
      expect(sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'legacy-work', kind: 'work', projectPath: 'D:\\old-project' }),
        expect.objectContaining({ id: 'legacy-chat', kind: 'chat', projectPath: null })
      ]))
      expect(await store.listMessages('legacy-work')).toEqual([
        expect.objectContaining({ id: 'legacy-work-message', content: '项目历史仍在' })
      ])
      expect(await store.listMessages('legacy-chat')).toEqual([
        expect.objectContaining({ id: 'legacy-chat-message', content: '普通历史仍在' })
      ])
    }

    const admin = await mysql.createConnection(config)
    try {
      const [sessions] = await admin.query('SELECT COUNT(*) AS count FROM sessions')
      const [messages] = await admin.query('SELECT COUNT(*) AS count FROM messages')
      expect((sessions as { count: number }[])[0].count).toBe(2)
      expect((messages as { count: number }[])[0].count).toBe(2)
    } finally { await admin.end() }
  })
})

describe.skipIf(!enabled || !/^aiagent_3a_restore_\d{8}_\d{6}$/.test(restoredDatabase ?? ''))(
  'restored legacy MySQL history migration', () => {
    it('keeps every existing session and message unchanged across two migrations', async () => {
      const restoredConfig = { ...config, database: restoredDatabase! }
      const connection = await mysql.createConnection(restoredConfig)
      try {
        const sessionSql = 'SELECT id, title, project_path, pinned, created_at, updated_at FROM sessions ORDER BY id'
        const messageSql = 'SELECT id, session_id, role, content, blocks, attachments, status, timestamp FROM messages ORDER BY id'
        const [beforeSessions] = await connection.query(sessionSql)
        const [beforeMessages] = await connection.query(messageSql)
        expect((beforeSessions as unknown[]).length).toBeGreaterThan(0)
        expect((beforeMessages as unknown[]).length).toBeGreaterThan(0)

        for (let pass = 0; pass < 2; pass++) {
          const store = await MySqlStore.connect(restoredConfig)
          const sessions = await store.listSessions()
          expect(sessions).toHaveLength((beforeSessions as unknown[]).length)
          for (const session of sessions) {
            expect(session.kind).toBe(session.projectPath ? 'work' : 'chat')
          }
          const [afterSessions] = await connection.query(sessionSql)
          const [afterMessages] = await connection.query(messageSql)
          expect(afterSessions).toEqual(beforeSessions)
          expect(afterMessages).toEqual(beforeMessages)
        }
      } finally { await connection.end() }
    })
  }
)
