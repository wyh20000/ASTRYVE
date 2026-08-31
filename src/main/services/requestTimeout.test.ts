import { describe, expect, it, vi } from 'vitest'
import {
  CONNECT_TIMEOUT_MESSAGE,
  fetchWithRequestTimeout
} from './requestTimeout'

describe('fetchWithRequestTimeout', () => {
  it('aborts a request that never connects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      )
    )
    await expect(fetchWithRequestTimeout('https://example.com', {}, undefined, 5, 100)).rejects.toThrow(
      CONNECT_TIMEOUT_MESSAGE
    )
    vi.unstubAllGlobals()
  })

  it('propagates session cancellation', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      )
    )
    const request = fetchWithRequestTimeout('https://example.com', {}, controller.signal, 100, 200)
    controller.abort(new Error('cancelled'))
    await expect(request).rejects.toThrow('cancelled')
    vi.unstubAllGlobals()
  })
})
