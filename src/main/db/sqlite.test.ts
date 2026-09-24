import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactStore, initArtifactStore, materializeMessage, messageArtifactRefs } from '../services/artifactStore'
import { SqliteStore } from './sqlite'
import type { Session } from '@shared/types'
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => {
  exec: (sql: string) => void; close: () => void
} }

const dirs: string[] = []
const databases: SqliteStore[] = []

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'astryve-sqlite-test-'))
  dirs.push(path)
  initArtifactStore(path)
  return path
}

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true })
})

describe('SQLite and Artifact Store', () => {
  it('migrates legacy session ownership without losing history', async () => {
    const root = await directory()
    const path = join(root, 'legacy.sqlite')
    const old = new DatabaseSync(path)
    old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, project_path TEXT,
      pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO sessions VALUES ('work', '项目记录', 'D:\\project-a', 0, 1, 2);
      INSERT INTO sessions VALUES ('chat', '普通记录', NULL, 0, 1, 3);`)
    old.close()
    const store = await SqliteStore.open(path)
    databases.push(store)
    expect(await store.getSession('work')).toMatchObject({ kind: 'work', projectPath: 'D:\\project-a' })
    expect(await store.getSession('chat')).toMatchObject({ kind: 'chat', projectPath: null })
    expect((await stat(`${path}.pre-work-chat.bak`)).size).toBeGreaterThan(0)
  })

  it('persists a new work session with a stable workspace identity', async () => {
    const root = await directory()
    const path = join(root, 'work.sqlite')
    const store = await SqliteStore.open(path)
    const created = await store.createSession('工作', 'D:\\project-a', 'workspace-a')
    store.close()
    const reopened = await SqliteStore.open(path)
    databases.push(reopened)
    expect(await reopened.getSession(created.id)).toMatchObject({
      kind: 'work', projectPath: 'D:\\project-a', workspaceId: 'workspace-a'
    })
    await expect(reopened.createSession('incomplete', 'D:\\project-a')).rejects.toThrow('Session project identity is incomplete')
    await expect(reopened.createSession('incomplete', null, 'workspace-a')).rejects.toThrow('Session project identity is incomplete')
  })
  it('stores image bytes outside message rows and reloads them after reopening', async () => {
    const root = await directory()
    const dbPath = join(root, 'chat.sqlite')
    const store = await SqliteStore.open(dbPath)
    const session = await store.createSession('image')
    const dataRef = `data:image/png;base64,${Buffer.from('image bytes').toString('base64')}`
    const message = await store.insertMessage({
      sessionId: session.id, role: 'user', content: 'look', attachments: [{
        id: 'image', kind: 'image', name: 'a.png', contentType: 'image/png', dataRef
      }]
    })
    expect(message.attachments?.[0].dataRef).toBe(dataRef)
    const stored = (await store.listMessages(session.id))[0]
    expect(stored.attachments?.[0].dataRef).toMatch(/^artifact:[a-f0-9]{64}$/)
    expect((await materializeMessage(stored)).attachments?.[0].dataRef).toBe(dataRef)
    store.close()

    const reopened = await SqliteStore.open(dbPath)
    databases.push(reopened)
    expect((await materializeMessage((await reopened.listMessages(session.id))[0])).attachments?.[0].dataRef)
      .toBe(dataRef)
    expect((await readFile(dbPath)).includes(Buffer.from('image bytes'))).toBe(false)
  })

  it('imports legacy JSON once and preserves the original as a recoverable backup', async () => {
    const root = await directory()
    const legacy = join(root, 'ai-agent-data.json')
    const session: Session = {
      id: crypto.randomUUID(), title: 'old', kind: 'chat', projectPath: null,
      pinned: false, createdAt: 1, updatedAt: 2
    }
    await writeFile(legacy, JSON.stringify({ sessions: [session], messages: [{
      id: crypto.randomUUID(), sessionId: session.id, role: 'user', content: 'legacy',
      status: 'done', timestamp: 3
    }] }))
    const store = await SqliteStore.open(join(root, 'chat.sqlite'), legacy)
    databases.push(store)
    expect(await store.listSessions()).toMatchObject([{ id: session.id, title: 'old' }])
    expect((await store.listMessages(session.id))[0].content).toBe('legacy')
    expect((await readFile(legacy, 'utf8')).includes('legacy')).toBe(true)
  })

  it('moves legacy inline images into the artifact store during import', async () => {
    const root = await directory()
    const legacy = join(root, 'ai-agent-data.json')
    const session: Session = { id: crypto.randomUUID(), title: 'old image', kind: 'chat', projectPath: null,
      pinned: false, createdAt: 1, updatedAt: 2 }
    const dataRef = `data:image/png;base64,${Buffer.from('legacy pixels').toString('base64')}`
    await writeFile(legacy, JSON.stringify({ sessions: [session], messages: [{
      id: crypto.randomUUID(), sessionId: session.id, role: 'user', content: 'see',
      status: 'done', timestamp: 3, attachments: [{ id: 'image', kind: 'image',
        name: 'old.png', contentType: 'image/png', dataRef }]
    }] }))
    const store = await SqliteStore.open(join(root, 'chat.sqlite'), legacy)
    databases.push(store)
    const imported = (await store.listMessages(session.id))[0]
    expect(imported.attachments?.[0].dataRef).toMatch(/^artifact:/)
    expect((await materializeMessage(imported)).attachments?.[0].dataRef).toBe(dataRef)
  })

  it('deletes message references by session while retaining artifacts shared with another session', async () => {
    const root = await directory()
    const store = await SqliteStore.open(join(root, 'chat.sqlite'))
    databases.push(store)
    const first = await store.createSession('A')
    const second = await store.createSession('B')
    const image = `data:image/png;base64,${Buffer.from('shared image').toString('base64')}`
    for (const session of [first, second]) {
      await store.insertMessage({ sessionId: session.id, role: 'user', content: '', attachments: [{
        id: 'shared', kind: 'image', name: 'shared.png', contentType: 'image/png', dataRef: image
      }] })
    }
    const artifacts = new ArtifactStore(join(root, 'artifacts'))
    const ref = (await store.listMessages(second.id))[0].attachments![0].dataRef
    await store.deleteSession(first.id)
    expect(await store.listMessages(first.id)).toEqual([])
    expect(await artifacts.collectGarbage(new Set([ref]))).toBe(0)
    await store.deleteSession(second.id)
    expect(await artifacts.collectGarbage(new Set())).toBe(1)
  })

  it('rejects a single artifact beyond its quota before writing it', async () => {
    const root = await directory()
    const artifacts = new ArtifactStore(join(root, 'artifacts'))
    await expect(artifacts.put(Buffer.alloc(25 * 1024 * 1024 + 1), 'image/png', 'user'))
      .rejects.toThrow('附件大小无效')
  })

  it('does not reclaim a just-written artifact before its message commit can finish', async () => {
    const root = await directory()
    const artifacts = new ArtifactStore(join(root, 'artifacts'))
    const item = await artifacts.put(Buffer.from('in-flight'), 'text/plain', 'document')
    expect(await artifacts.collectGarbage(new Set(), 5 * 60_000)).toBe(0)
    expect((await artifacts.read(item.ref)).toString()).toBe('in-flight')
  })

  it('keeps parsed-document refs even when an older message has no turn envelope', () => {
    const documentRef = `artifact:${'a'.repeat(64)}`
    expect(messageArtifactRefs({
      id: 'm', sessionId: 's', role: 'user', content: '', status: 'done', timestamp: 1,
      attachments: [{ id: 'file', kind: 'file', name: 'a.pdf', contentType: 'application/pdf',
        dataRef: `artifact:${'b'.repeat(64)}`, meta: { documentRef } }]
    })).toContain(documentRef)
  })

  it('paginates 10,000 messages and deletes only orphaned artifact bytes', async () => {
    const root = await directory()
    const store = await SqliteStore.open(join(root, 'chat.sqlite'))
    databases.push(store)
    const session = await store.createSession('long')
    for (let i = 0; i < 10_000; i += 1) {
      await store.insertMessage({ id: `message-${String(i).padStart(5, '0')}`, sessionId: session.id,
        role: 'user', content: `line ${i}`, timestamp: i + 1 })
    }
    const latest = await store.listMessagesPage(session.id, undefined, 100)
    expect(latest).toHaveLength(100)
    expect(latest[0].content).toBe('line 9900')
    const previous = await store.listMessagesPage(session.id, { timestamp: latest[0].timestamp, id: latest[0].id }, 100)
    expect(previous.at(-1)?.content).toBe('line 9899')

    const artifacts = new ArtifactStore(join(root, 'artifacts'))
    const item = await artifacts.put(Buffer.from('some bytes'), 'text/plain', 'test')
    expect((await artifacts.read(item.ref)).toString()).toBe('some bytes')
    expect(await artifacts.collectGarbage(new Set([item.ref]))).toBe(0)
    expect(await artifacts.collectGarbage(new Set())).toBe(1)
  }, 45_000)
})
