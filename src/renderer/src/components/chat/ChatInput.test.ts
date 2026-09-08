import { describe, expect, it } from 'vitest'
import { moveSlashSelection } from './ChatInput'
import { directoriesToRefresh } from '../layout/workspaceRefresh'

describe('Skill shortcut keyboard navigation', () => {
  it('moves through results and wraps at both ends', () => {
    expect(moveSlashSelection(0, 3, 1)).toBe(1)
    expect(moveSlashSelection(2, 3, 1)).toBe(0)
    expect(moveSlashSelection(0, 3, -1)).toBe(2)
    expect(moveSlashSelection(0, 0, 1)).toBe(0)
  })
})

describe('workspace tree live refresh', () => {
  it('refreshes root and every loaded ancestor for a new file', () => {
    expect(directoriesToRefresh(['src/main/newFile.ts'], ['', 'src', 'src/main', 'docs'])).toEqual([
      '', 'src/main', 'src'
    ])
  })

  it('refreshes every loaded directory after a successful command with unknown changed paths', () => {
    expect(directoriesToRefresh([], ['', 'src', 'docs'])).toEqual(['', 'src', 'docs'])
  })
})
