import { describe, expect, it } from 'vitest'
import { isRetryableStreamError } from './modelProvider'

describe('isRetryableStreamError', () => {
  it.each([
    new TypeError('terminated'),
    new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } }),
    Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
  ])('识别可重试的流中断：%s', (error) => {
    expect(isRetryableStreamError(error)).toBe(true)
  })

  it.each([new Error('HTTP 401'), new Error('HTTP 400'), new Error('invalid request')])(
    '不重试配置或请求错误：%s',
    (error) => {
      expect(isRetryableStreamError(error)).toBe(false)
    }
  )
})
