import { describe, expect, it, vi } from 'vitest'
import { resolveTrustedExecutable } from './trustedExecutable'

describe('resolveTrustedExecutable', () => {
  it('resolves only fixed logical executables', async () => {
    const lookup = vi.fn(async () => 'C:\\Tools\\git.exe')
    await expect(resolveTrustedExecutable('git', lookup)).resolves.toEqual({
      executable: 'C:\\Tools\\git.exe',
      prefixArgs: [],
      trustedPathEntries: ['C:\\Tools']
    })
    await expect(resolveTrustedExecutable('powershell' as never, lookup)).rejects.toThrow('EXECUTABLE_NOT_ALLOWED')
  })

  it('fails closed when an executable is absent', async () => {
    await expect(resolveTrustedExecutable('node', async () => undefined)).rejects.toThrow('EXECUTABLE_NOT_FOUND:node')
  })
})
