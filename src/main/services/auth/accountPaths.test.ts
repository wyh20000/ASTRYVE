import { describe, expect, it } from 'vitest'
import { accountDataPath } from './accountPaths'

describe('accountDataPath', () => {
  it('places each validated account in its own directory', () => {
    const first = accountDataPath('D:/app-data', '550e8400-e29b-41d4-a716-446655440000')
    const second = accountDataPath('D:/app-data', '550e8400-e29b-41d4-a716-446655440001')
    expect(first).not.toBe(second)
    expect(first).toMatch(/accounts[\\/]550e8400-e29b-41d4-a716-446655440000$/)
  })

  it('rejects traversal and arbitrary names', () => {
    for (const invalid of ['..', '../data', 'admin', '', '550e8400-e29b-41d4-a716-446655440000/..']) {
      expect(() => accountDataPath('D:/app-data', invalid)).toThrow()
    }
  })
})
