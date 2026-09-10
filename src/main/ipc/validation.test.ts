import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import {
  InputValidationError,
  assertTrustedIpcSender,
  configureTrustedIpcSender,
  validateSendMessageInput,
  validateWorkspaceId,
  validateWorkspaceRelativePath
} from './validation'

function eventFor(url: string, mainFrame = true): IpcMainInvokeEvent {
  const senderFrame = { url }
  return {
    senderFrame,
    sender: { getURL: () => url, mainFrame: mainFrame ? senderFrame : { url } }
  } as unknown as IpcMainInvokeEvent
}

describe('workspace IPC validation', () => {
  it('accepts only UUID-like workspace ids and bounded string paths', () => {
    expect(validateWorkspaceId('d9428888-122b-11e1-b85c-61cd3cbb3210')).toBeTruthy()
    expect(() => validateWorkspaceId('../workspace')).toThrow(InputValidationError)
    expect(validateWorkspaceRelativePath(undefined, true)).toBe('')
    expect(() => validateWorkspaceRelativePath(42)).toThrow(InputValidationError)
    expect(() => validateWorkspaceRelativePath('x'.repeat(4097))).toThrow(InputValidationError)
  })

  it('allows only the configured renderer main frame', () => {
    configureTrustedIpcSender('file:///D:/app/index.html')
    expect(() => assertTrustedIpcSender(eventFor('file:///D:/app/index.html'))).not.toThrow()
    expect(() => assertTrustedIpcSender(eventFor('file:///D:/other/index.html'))).toThrow(InputValidationError)
    expect(() => assertTrustedIpcSender(eventFor('file:///D:/app/index.html', false))).toThrow(InputValidationError)

    configureTrustedIpcSender('http://127.0.0.1:5173/')
    expect(() => assertTrustedIpcSender(eventFor('http://127.0.0.1:5173/'))).not.toThrow()
    expect(() => assertTrustedIpcSender(eventFor('http://localhost:5173/'))).toThrow(InputValidationError)
    expect(() => assertTrustedIpcSender(eventFor('https://evil.example/'))).toThrow(
      InputValidationError
    )
  })

  it('refuses remote or credential-bearing renderer entry configuration', () => {
    expect(() => configureTrustedIpcSender('https://evil.example/')).toThrow('渲染入口')
    expect(() => configureTrustedIpcSender('http://user:secret@localhost:5173/')).toThrow('渲染入口')
  })

  it('accepts bounded Skill ids and rejects forged selections', () => {
    const id = `project:${'a'.repeat(12)}:code-review`
    expect(validateSendMessageInput({ sessionId: crypto.randomUUID(), content: 'review', skillIds: [id, id] }).skillIds).toEqual([id])
    expect(() => validateSendMessageInput({ sessionId: crypto.randomUUID(), content: 'review', skillIds: ['../skill'] })).toThrow(InputValidationError)
  })

  it('accepts bounded plugin ids, deduplicates them and rejects forged selections', () => {
    const sessionId = crypto.randomUUID()
    expect(validateSendMessageInput({ sessionId, content: 'inspect', pluginIds: ['acme.browser', 'acme.browser'] }).pluginIds)
      .toEqual(['acme.browser'])
    expect(() => validateSendMessageInput({ sessionId, content: 'inspect', pluginIds: ['../plugin'] }))
      .toThrow(InputValidationError)
  })
})
