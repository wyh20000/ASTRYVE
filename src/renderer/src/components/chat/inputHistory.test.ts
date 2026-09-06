import { describe, expect, it } from 'vitest'
import { stepInputHistory } from './inputHistory'

describe('input history', () => {
  it('walks backward and forward while restoring the draft', () => {
    const history = ['第一条', '第二条']
    const previous = stepInputHistory(history, '草稿', { index: null, draft: '' }, 'previous')
    expect(previous).toEqual({ value: '第二条', state: { index: 1, draft: '草稿' } })
    const older = stepInputHistory(history, previous.value, previous.state, 'previous')
    expect(older.value).toBe('第一条')
    const newer = stepInputHistory(history, older.value, older.state, 'next')
    expect(newer.value).toBe('第二条')
    expect(stepInputHistory(history, newer.value, newer.state, 'next').value).toBe('草稿')
  })
})
