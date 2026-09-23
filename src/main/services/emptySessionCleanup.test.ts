import { describe, expect, it, vi } from 'vitest'
import { cleanupEmptySessions } from './emptySessionCleanup'

describe('empty session cleanup', () => {
  it('deletes every zero-message session and preserves conversations with content', async () => {
    const deleteSession = vi.fn(async (_id: string) => undefined)
    const sessions = [
      { id: 'empty-1', title: '', kind: 'chat' as const, projectPath: null, pinned: false, createdAt: 1, updatedAt: 1 },
      { id: 'kept', title: '有内容', kind: 'chat' as const, projectPath: null, pinned: false, createdAt: 2, updatedAt: 2 },
      { id: 'empty-2', title: '新对话', kind: 'chat' as const, projectPath: null, pinned: false, createdAt: 3, updatedAt: 3 }
    ]
    const count = await cleanupEmptySessions({
      listSessions: async () => sessions,
      listMessages: async (id) => id === 'kept' ? [{
        id: 'message-1', sessionId: id, role: 'user', content: 'hello', status: 'done', timestamp: 2
      }] : id === 'empty-2' ? [{
        id: 'placeholder', sessionId: id, role: 'assistant', content: '', status: 'error', timestamp: 3
      }] : [],
      deleteSession
    })
    expect(count).toBe(2)
    expect(deleteSession.mock.calls.map(([id]) => id)).toEqual(['empty-1', 'empty-2'])
  })
})
