import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ai-agent-test' } }))

import { recoverInterruptedMessages } from './index'
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

  it('旧 revision 不能覆盖已经落库的终态', async () => {
    const s = await store.createSession('s')
    const message = await store.insertMessage({
      sessionId: s.id, role: 'assistant', content: '生成中', status: 'streaming', revision: 2
    })
    await store.upsertMessage({ ...message, content: '已停止', status: 'cancelled', revision: 3 })
    await store.upsertMessage({ ...message, content: '迟到分片', status: 'streaming', revision: 2 })
    expect((await store.listMessages(s.id))[0]).toMatchObject({
      content: '已停止', status: 'cancelled', revision: 3
    })
  })

  it('启动恢复会把遗留流式消息收敛为 interrupted', async () => {
    const s = await store.createSession('s')
    await store.insertMessage({
      sessionId: s.id, role: 'assistant', content: 'partial', status: 'streaming', revision: 6
    })
    expect(await recoverInterruptedMessages(store)).toBe(1)
    expect((await store.listMessages(s.id))[0]).toMatchObject({
      status: 'interrupted', revision: 7, finishReason: 'app_restarted'
    })
  })

  it('会话创建后保持固定类型和项目身份', async () => {
    const chat = await store.createSession('普通对话')
    const work = await store.createSession('工作', 'D:\\project', 'workspace-a')
    await store.renameSession(chat.id, '重命名')
    await store.touchSession(work.id)
    expect(await store.getSession(chat.id)).toMatchObject({ kind: 'chat', projectPath: null, workspaceId: null })
    expect(await store.getSession(work.id)).toMatchObject({ kind: 'work', projectPath: 'D:\\project', workspaceId: 'workspace-a' })
    await expect(store.createSession('不完整', 'D:\\project')).rejects.toThrow('Session project identity is incomplete')
    await expect(store.createSession('不完整', null, 'workspace-a')).rejects.toThrow('Session project identity is incomplete')
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
