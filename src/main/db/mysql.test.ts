import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const rows = [
    { id: 'old-work', title: '项目历史', kind: 'chat', workspace_id: null, project_path: 'D:\\project',
      pinned: 0, created_at: 1, updated_at: 2 },
    { id: 'old-chat', title: '普通历史', kind: 'chat', workspace_id: null, project_path: null,
      pinned: 0, created_at: 1, updated_at: 3 }
  ]
  return {
    rows,
    failOn: '' as string,
    queries: [] as string[],
    adminEnd: vi.fn(async () => undefined),
    poolEnd: vi.fn(async () => undefined)
  }
})

vi.mock('mysql2/promise', () => ({ default: {
  escapeId: (name: string) => `\`${name}\``,
  createConnection: vi.fn(async () => ({ query: async () => [[], []], end: mocks.adminEnd })),
  createPool: vi.fn(() => ({
    end: mocks.poolEnd,
    query: async (statement: string) => {
      mocks.queries.push(statement)
      if (mocks.failOn && statement.includes(mocks.failOn)) throw new Error('migration failed')
      if (statement.startsWith('ALTER TABLE')) throw { code: 'ER_DUP_FIELDNAME' }
      if (statement.startsWith('UPDATE sessions SET kind')) {
        for (const row of mocks.rows) {
          if (row.project_path !== null && row.kind === 'chat') row.kind = 'work'
        }
      }
      if (statement.startsWith('SELECT * FROM sessions')) return [mocks.rows, []]
      return [[], []]
    }
  }))
} }))

import { MySqlStore } from './mysql'

const config = { host: 'localhost', port: 3306, user: 'test', password: 'test', database: 'isolated_test' }

describe('MySQL legacy session migration', () => {
  beforeEach(() => {
    mocks.rows[0].kind = 'chat'
    mocks.rows[1].kind = 'chat'
    mocks.failOn = ''
    mocks.queries.length = 0
    mocks.adminEnd.mockClear()
    mocks.poolEnd.mockClear()
  })

  it('preserves old work and chat rows across repeated migrations', async () => {
    const first = await MySqlStore.connect(config)
    expect(await first.listSessions()).toMatchObject([
      { id: 'old-work', kind: 'work', projectPath: 'D:\\project', workspaceId: null },
      { id: 'old-chat', kind: 'chat', projectPath: null, workspaceId: null }
    ])
    const second = await MySqlStore.connect(config)
    expect((await second.listSessions()).map((session) => session.id)).toEqual(['old-work', 'old-chat'])
    expect(mocks.queries.filter((statement) => statement.startsWith('UPDATE sessions SET kind'))).toHaveLength(2)
    expect(mocks.poolEnd).not.toHaveBeenCalled()
  })

  it('closes the pool if a schema migration fails', async () => {
    mocks.failOn = 'UPDATE sessions SET kind'
    await expect(MySqlStore.connect(config)).rejects.toThrow('migration failed')
    expect(mocks.adminEnd).toHaveBeenCalledTimes(1)
    expect(mocks.poolEnd).toHaveBeenCalledTimes(1)
  })
})
