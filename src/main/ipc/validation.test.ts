import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import {
  InputValidationError,
  assertTrustedIpcSender,
  validateWorkspaceId,
  validateWorkspaceRelativePath
} from './validation'

function eventFor(url: string): IpcMainInvokeEvent {
  return {
    senderFrame: { url },
    sender: { getURL: () => url }
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

  it('allows the packaged app and local dev server but rejects remote senders', () => {
    expect(() => assertTrustedIpcSender(eventFor('file:///D:/app/index.html'))).not.toThrow()
    expect(() => assertTrustedIpcSender(eventFor('http://127.0.0.1:5173/'))).not.toThrow()
    expect(() => assertTrustedIpcSender(eventFor('https://evil.example/'))).toThrow(
      InputValidationError
    )
  })
})
