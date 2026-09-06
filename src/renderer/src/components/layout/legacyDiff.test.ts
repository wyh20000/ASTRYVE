import { describe, expect, it } from 'vitest'
import type { PatchDiffFile } from '@shared/types'
import { hydrateLegacyDiff, visibleDiffContents } from './legacyDiff'

const file = (overrides: Partial<PatchDiffFile> = {}): PatchDiffFile => ({
  path: 'src/a.ts', status: 'modified', linesAdded: 1, linesDeleted: 1,
  diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-old\n+new',
  ...overrides
})

describe('legacy diff hydration', () => {
  it('applies an old diff when the host still contains the original side', () => {
    expect(hydrateLegacyDiff('old\nkeep\n', file())).toEqual({
      original: 'old\nkeep\n', modified: 'new\nkeep\n'
    })
  })

  it('reverses an old diff when the host already contains the modified side', () => {
    expect(hydrateLegacyDiff('new\nkeep\n', file())).toEqual({
      original: 'old\nkeep\n', modified: 'new\nkeep\n'
    })
  })

  it('does not leave equal Monaco models when a changed diff has stale exact fields', () => {
    expect(visibleDiffContents(file(), { original: 'new\n', modified: 'new\n' })).toEqual({
      original: 'old\n', modified: 'new\n'
    })
  })
})
