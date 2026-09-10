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
  it('normalizes lettered options, removes repeated choices from the question, and preserves recommendations', () => {
    const { webContents, send } = renderer()
    const controller = new AbortController()

    void requestUserInput(webContents, 'session-options', { questions: [{
      id: 'scope',
      question: '这次优化的覆盖范围？ A 全局系统优化；B 聚焦主界面；C 只修已知痛点。',
      options: [
        { label: 'B. 聚焦主界面' },
        { label: 'A. 全局系统优化（推荐）' },
        { label: 'C. 只修已知痛点' }
      ]
    }] }, controller.signal)

    expect(send.mock.calls[0][1].questions[0]).toEqual({
      id: 'scope',
      question: '这次优化的覆盖范围？',
      header: undefined,
      options: [
        { label: '全局系统优化', description: undefined, recommended: true },
        { label: '聚焦主界面', description: undefined, recommended: false },
        { label: '只修已知痛点', description: undefined, recommended: false }
      ]
    })
    controller.abort('user')
  })

  it('accepts seven options and an explicit recommendation flag', () => {
    const { webContents, send } = renderer()
    const controller = new AbortController()
    const options = Array.from({ length: 7 }, (_, index) => ({
      label: `选项 ${index + 1}`,
      recommended: index === 3
    }))

    void requestUserInput(webContents, 'session-seven', {
      questions: [{ id: 'choice', question: '请选择', options }]
    }, controller.signal)

    expect(send.mock.calls[0][1].questions[0].options).toHaveLength(7)
    expect(send.mock.calls[0][1].questions[0].options[3]).toMatchObject({
      label: '选项 4', recommended: true
    })
    controller.abort('user')
  })

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
