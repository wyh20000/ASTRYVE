import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { requestUserInput, submitUserInput } from './userInput'

function renderer(id = 7): { webContents: WebContents; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  return {
    webContents: { id, isDestroyed: () => false, send } as unknown as WebContents,
    send
  }
}

describe('interactive user input coordinator', () => {
  it('waits for the owning renderer and returns every answer to the model', async () => {
    const { webContents, send } = renderer()
    const controller = new AbortController()
    const pending = requestUserInput(webContents, 'session-1', { questions: [
      { id: 'runtime', question: '运行方式？', options: [{ label: '隔离' }, { label: '共享' }] },
      { id: 'notes', question: '其他说明？' }
    ] }, controller.signal)
    const request = send.mock.calls[0][1]
    expect(request).toMatchObject({ sessionId: 'session-1', questions: [{ id: 'runtime' }, { id: 'notes' }] })
    expect(submitUserInput({
      requestId: request.id,
      sessionId: 'session-1',
      answers: { runtime: '隔离', notes: '按推荐' }
    }, 7)).toBe(true)
    await expect(pending).resolves.toEqual({ ok: true, value: { answers: [
      { id: 'runtime', answer: '隔离' }, { id: 'notes', answer: '按推荐' }
    ] } })
    expect(send.mock.calls.at(-1)?.[1]).toEqual({ id: request.id, sessionId: 'session-1' })
  })

  it('rejects another renderer and resolves cancellation', async () => {
    const { webContents, send } = renderer()
    const controller = new AbortController()
    const pending = requestUserInput(webContents, 'session-1', {
      questions: [{ id: 'q1', question: '继续吗？' }]
    }, controller.signal)
    const request = send.mock.calls[0][1]
    expect(submitUserInput({ requestId: request.id, sessionId: 'session-1', answers: { q1: '是' } }, 8)).toBe(false)
    controller.abort('user')
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'TASK_CANCELLED' } })
  })
})

