import { describe, expect, it } from 'vitest'
import { assertDocumentSize, MAX_FILE_BYTES } from './image'

describe('文档大小预检', () => {
  it('允许 20MB 及以下文件', () => {
    expect(() => assertDocumentSize(MAX_FILE_BYTES, 'ok.pdf')).not.toThrow()
  })

  it('读取前立即拒绝超过 20MB 的文件', () => {
    expect(() => assertDocumentSize(MAX_FILE_BYTES + 1, 'large.pdf')).toThrow(
      '文件过大（>20MB）：large.pdf'
    )
  })
})
