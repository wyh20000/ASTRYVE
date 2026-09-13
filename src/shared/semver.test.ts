import { describe, expect, it } from 'vitest'
import { compareSemver } from './semver'

describe('semantic version ordering', () => {
  it.each([
    ['1.0.0', '1.0.0-beta', 1],
    ['1.0.0-beta.10', '1.0.0-beta.2', 1],
    ['1.0.0-beta', '1.0.0-beta.1', -1],
    ['2.0.0', '10.0.0', -1]
  ] as const)('compares %s against %s', (left, right, direction) => {
    expect(Math.sign(compareSemver(left, right))).toBe(direction)
  })
})
