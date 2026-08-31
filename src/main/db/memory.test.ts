import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ai-agent-test' } }))

import { MemoryStore } from './memory'

describe('MemoryStore（无文件路径，纯内存）', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  it('创建并列出会话（按 updatedAt 降序）', async () => {
    const a = await store.createSession('会话A')
    await new Promise((r) => setTimeout(r, 5))
    const b = await store.createSession('会话B')
    const list = await store.listSessions()
    expect(list.map((s) => s.id)).toEqual([b.id, a.id])
  })

  it('重命名 / touch / 删除级联', async () => {
    const s = await store.createSession('old')
    await store.insertMessage({ sessionId: s.id, role: 'user', content: 'hi' })

    const renamed = await store.renameSession(s.id, 'new')
    expect(renamed?.title).toBe('new')

    const touched = await store.touchSession(s.id)
    expect(touched?.id).toBe(s.id)

    await store.deleteSession(s.id)
    expect(await store.getSession(s.id)).toBeNull()
    expect(await store.listMessages(s.id)).toEqual([])
  })

  it('消息 insert/upsert 与时间排序', async () => {
    const s = await store.createSession('s')
    await store.insertMessage({ sessionId: s.id, role: 'user', content: 'a', timestamp: 1000 })
    const m2 = await store.insertMessage({
      sessionId: s.id,
      role: 'assistant',
      content: 'b',
      timestamp: 2000
    })

    let list = await store.listMessages(s.id)
    expect(list.map((m) => m.content)).toEqual(['a', 'b'])

    await store.upsertMessage({ ...m2, content: 'b2' })
    list = await store.listMessages(s.id)
    expect(list.length).toBe(2)
    expect(list.find((m) => m.id === m2.id)?.content).toBe('b2')
  })

  it('消息默认状态为 done', async () => {
    const s = await store.createSession('s')
    const m = await store.insertMessage({ sessionId: s.id, role: 'user', content: 'hi' })
    expect(m.status).toBe('done')
  })

  it('为会话持久化当前项目路径', async () => {
    const session = await store.createSession('workspace')
    const updated = await store.setSessionProjectPath(session.id, 'D:\\project')
    expect(updated?.projectPath).toBe('D:\\project')
    expect((await store.getSession(session.id))?.projectPath).toBe('D:\\project')
  })

  it('附件随消息持久化', async () => {
    const s = await store.createSession('s')
    await store.insertMessage({
      sessionId: s.id,
      role: 'user',
      content: '',
      attachments: [
        { id: 'a1', kind: 'image', name: 'x.png', contentType: 'image/png', dataRef: 'data:image/png;base64,xx' }
      ]
    })
    const list = await store.listMessages(s.id)
    expect(list[0].attachments?.[0]?.kind).toBe('image')
  })
})
