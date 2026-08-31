import { describe, expect, it } from 'vitest'
import dangerousCommands from '../../../../fixtures/p3-dangerous-commands.json'

describe('P3 security regression corpus', () => {
  it('contains unique, structured cases with an explicit expected decision', () => {
    const ids = new Set<string>()
    expect(dangerousCommands.version).toBe(1)
    expect(dangerousCommands.cases.length).toBeGreaterThanOrEqual(4)

    for (const testCase of dangerousCommands.cases) {
      expect(testCase.id).toMatch(/^[a-z0-9-]+$/)
      expect(ids.has(testCase.id)).toBe(false)
      expect(testCase.executable.length).toBeGreaterThan(0)
      expect(Array.isArray(testCase.args)).toBe(true)
      expect(['allow', 'ask', 'deny']).toContain(testCase.expected)
      ids.add(testCase.id)
    }
  })
})
