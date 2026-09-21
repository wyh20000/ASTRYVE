import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../../db/memory'
import { accountDataPath } from './accountPaths'

describe('accountDataPath', () => {
  it('places each validated account in its own directory', () => {
    const first = accountDataPath('D:/app-data', '550e8400-e29b-41d4-a716-446655440000')
    const second = accountDataPath('D:/app-data', '550e8400-e29b-41d4-a716-446655440001')
    expect(first).not.toBe(second)
    expect(first).toMatch(/accounts[\\/]550e8400-e29b-41d4-a716-446655440000$/)
  })

  it('rejects traversal and arbitrary names', () => {
    for (const invalid of ['..', '../data', 'admin', '', '550e8400-e29b-41d4-a716-446655440000/..']) {
      expect(() => accountDataPath('D:/app-data', invalid)).toThrow()
    }
  })

  it('keeps persisted conversations separate across A to B to A restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiagent-account-isolation-'))
    const accountA = '550e8400-e29b-41d4-a716-446655440000'
    const accountB = '550e8400-e29b-41d4-a716-446655440001'
    const fileFor = (id: string): string => join(accountDataPath(root, id), 'ai-agent-data.json')
    try {
      const firstA = new MemoryStore(fileFor(accountA))
      const aSession = await firstA.createSession('A private conversation')
      await firstA.insertMessage({ sessionId: aSession.id, role: 'user', content: 'A secret' })

      const firstB = new MemoryStore(fileFor(accountB))
      expect(await firstB.listSessions()).toEqual([])
      expect(await firstB.listMessages(aSession.id)).toEqual([])
      const bSession = await firstB.createSession('B private conversation')
      await firstB.insertMessage({ sessionId: bSession.id, role: 'user', content: 'B secret' })

      const secondA = new MemoryStore(fileFor(accountA))
      expect((await secondA.listSessions()).map((session) => session.id)).toEqual([aSession.id])
      expect((await secondA.listMessages(aSession.id)).map((message) => message.content)).toEqual(['A secret'])
      expect(await secondA.getSession(bSession.id)).toBeNull()

      const secondB = new MemoryStore(fileFor(accountB))
      expect((await secondB.listSessions()).map((session) => session.id)).toEqual([bSession.id])
      expect(await secondB.getSession(aSession.id)).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
