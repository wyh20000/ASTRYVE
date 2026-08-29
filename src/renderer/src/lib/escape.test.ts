import { describe, it, expect } from 'vitest'
import { escapeHtml } from './escape'

describe('escapeHtml', () => {
  it('转义 & < >', () => {
    expect(escapeHtml('<script>alert("x")&</script>')).toBe(
      '&lt;script&gt;alert("x")&amp;&lt;/script&gt;'
    )
  })

  it('无特殊字符时原样返回', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })

  it('空字符串返回空字符串', () => {
    expect(escapeHtml('')).toBe('')
  })
})
