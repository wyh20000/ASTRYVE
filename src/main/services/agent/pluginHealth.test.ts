import { beforeEach, describe, expect, it } from 'vitest'
import { clearPluginFailure, isPluginQuarantined, recordPluginFailure, recoverPluginHealth } from './pluginHealth'

describe('plugin runtime health', () => {
  beforeEach(() => recoverPluginHealth('acme.tools'))

  it('quarantines after three consecutive failures and supports manual recovery', () => {
    expect(recordPluginFailure('acme.tools')).toBe(false)
    expect(recordPluginFailure('acme.tools')).toBe(false)
    expect(recordPluginFailure('acme.tools')).toBe(true)
    expect(isPluginQuarantined('acme.tools')).toBe(true)
    recoverPluginHealth('acme.tools')
    expect(isPluginQuarantined('acme.tools')).toBe(false)
  })

  it('clears the consecutive failure counter after a successful call', () => {
    recordPluginFailure('acme.tools')
    recordPluginFailure('acme.tools')
    clearPluginFailure('acme.tools')
    expect(recordPluginFailure('acme.tools')).toBe(false)
  })
})
