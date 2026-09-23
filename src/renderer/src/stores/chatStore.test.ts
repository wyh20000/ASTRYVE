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

  it('releases the send lock if the IPC bridge rejects before returning a result', async () => {
    Object.assign(window.agent, { message: { send: vi.fn(async () => { throw new Error('bridge closed') }) } })
    const result = await useChatStore.getState().send('session', 'hello')
    expect(result).toMatchObject({ ok: false, error: { code: 'SEND_UNAVAILABLE' } })
    expect(useChatStore.getState().sending.session).toBe(false)
    expect(useChatStore.getState().activeGenerations.session).toBeUndefined()
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

  it('shows history load errors without clearing existing messages, then permits retry', async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'DB_ERR', message: '数据库暂时不可读' } })
      .mockResolvedValueOnce({ ok: true, data: [assistant({ status: 'done' })] })
    Object.assign(window.agent, { message: { list } })
    useChatStore.setState({ messages: { session: [assistant({ content: '已显示内容' })] } })
    await useChatStore.getState().load('session')
    expect(useChatStore.getState().loadErrors.session).toBe('数据库暂时不可读')
    expect(useChatStore.getState().messages.session[0].content).toBe('已显示内容')
    await useChatStore.getState().load('session')
    expect(useChatStore.getState().loadErrors.session).toBeUndefined()
  })

  it('forgets a removed session and ignores late message or load results', async () => {
    let release!: (result: { ok: true; data: Message[] }) => void
    Object.assign(window.agent, { message: { list: vi.fn(() => new Promise((resolve) => { release = resolve })) } })
    useChatStore.setState({ messages: { session: [assistant()] }, sending: { session: true },
      activeGenerations: { session: 'generation' } })
    const pending = useChatStore.getState().load('session')
    useChatStore.getState().forgetSession('session')
    release({ ok: true, data: [assistant({ content: '迟到' })] })
    await pending
    useChatStore.getState().upsertMessage(assistant({ content: '迟到事件' }))
    expect(useChatStore.getState().messages.session).toBeUndefined()
    expect(useChatStore.getState().sending.session).toBeUndefined()
    expect(useChatStore.getState().activeGenerations.session).toBeUndefined()
  })
})
