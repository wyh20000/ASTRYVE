// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sessionStore', () => ({
  useSessionStore: { getState: () => ({ touch: vi.fn().mockResolvedValue(undefined) }) }
}))

import { useChatStore } from './chatStore'
import type { Message } from '@shared/types'

function assistant(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant', sessionId: 'session', generationId: 'generation', revision: 1,
    role: 'assistant', content: '', status: 'streaming', timestamp: 1, ...overrides
  }
}

describe('chatStore generation transaction', () => {
  beforeEach(() => {
    useChatStore.getState().clear()
  })

  it('locks synchronously and does not get stuck when terminal event wins the IPC race', async () => {
    let resolveSend!: (value: { ok: true; data: Message }) => void
    const sendResult = new Promise<{ ok: true; data: Message }>((resolve) => { resolveSend = resolve })
    Object.assign(window.agent, {
      message: {
        send: vi.fn(() => sendResult), list: vi.fn(), stop: vi.fn(), respondInput: vi.fn()
      }
    })

    const pending = useChatStore.getState().send('session', 'hello')
    const generationId = useChatStore.getState().activeGenerations.session
    expect(useChatStore.getState().sending.session).toBe(true)
    expect(generationId).toBeTruthy()

    useChatStore.getState().upsertMessage(assistant({
      generationId, status: 'done', finishReason: 'completed', revision: 2
    }))
    resolveSend({ ok: true, data: {
      id: generationId!, sessionId: 'session', role: 'user', content: 'hello', status: 'done', timestamp: 0
    } })
    await pending

    expect(useChatStore.getState().sending.session).toBe(false)
    expect(useChatStore.getState().activeGenerations.session).toBeUndefined()
  })

  it('rejects a duplicate send while a generation is active', async () => {
    Object.assign(window.agent, {
      message: {
        send: vi.fn(() => new Promise(() => undefined)), list: vi.fn(), stop: vi.fn(), respondInput: vi.fn()
      }
    })
    void useChatStore.getState().send('session', 'first')
    const duplicate = await useChatStore.getState().send('session', 'second')
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'ALREADY_SENDING' } })
  })

  it('ignores stale revisions and old-generation terminal events', () => {
    useChatStore.setState({
      sending: { session: true }, activeGenerations: { session: 'new-generation' },
      messages: { session: [assistant({ generationId: 'new-generation', revision: 3, content: 'new' })] }
    })
    useChatStore.getState().upsertMessage(assistant({
      generationId: 'old-generation', revision: 4, status: 'done', content: 'old done'
    }))
    expect(useChatStore.getState().sending.session).toBe(true)

    useChatStore.getState().upsertMessage(assistant({
      generationId: 'new-generation', revision: 2, content: 'late chunk'
    }))
    expect(useChatStore.getState().messages.session[0].content).toBe('new')
  })
})
