import type { PatchDiffFile } from '@shared/types'

export interface DiffContents { original: string; modified: string }

/** Reconstruct both sides of an old diff whether the host is before or after writeback. */
export function hydrateLegacyDiff(hostContent: string, file: PatchDiffFile): DiffContents {
  const removed = diffLines(file, '-')
  const added = diffLines(file, '+')
  const host = splitText(hostContent)

  if (file.status === 'added') {
    const addedAt = findSequence(host.lines, added)
    if (added.length && addedAt >= 0) {
      const original = [...host.lines]
      original.splice(addedAt, added.length)
      return { original: joinText(original, host.trailingNewline), modified: hostContent }
    }
    return { original: '', modified: added.length ? joinText(added, true) : hostContent }
  }

  const removedAt = findSequence(host.lines, removed)
  if (removed.length && removedAt >= 0) {
    const modified = [...host.lines]
    modified.splice(removedAt, removed.length, ...added)
    return { original: hostContent, modified: joinText(modified, host.trailingNewline) }
  }

  // The host may already contain the applied patch. Reverse it so historical
  // diffs still have a meaningful original side instead of two equal models.
  const addedAt = findSequence(host.lines, added)
  if (added.length && addedAt >= 0) {
    const original = [...host.lines]
    original.splice(addedAt, added.length, ...removed)
    return { original: joinText(original, host.trailingNewline), modified: hostContent }
  }

  if (file.status === 'deleted') {
    return { original: joinText(removed, true), modified: '' }
  }
  return {
    original: removed.length ? joinText(removed, true) : hostContent,
    modified: added.length ? joinText(added, true) : hostContent
  }
}

export function visibleDiffContents(file: PatchDiffFile, exact?: DiffContents): DiffContents {
  if (exact && (exact.original !== exact.modified || (file.linesAdded === 0 && file.linesDeleted === 0))) {
    return exact
  }
  return hydrateLegacyDiff(exact?.original ?? '', file)
}

function diffLines(file: PatchDiffFile, marker: '-' | '+'): string[] {
  const header = marker.repeat(3)
  return file.diff.split('\n')
    .filter((line) => line.startsWith(marker) && !line.startsWith(header))
    .map((line) => line.slice(1))
}

function splitText(content: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = /(?:\r\n|\n|\r)$/.test(content)
  const lines = content.split(/\r\n|\n|\r/)
  if (trailingNewline) lines.pop()
  return { lines, trailingNewline }
}

function joinText(lines: string[], trailingNewline: boolean): string {
  return lines.join('\n') + (trailingNewline && lines.length ? '\n' : '')
}

function findSequence(lines: string[], search: string[]): number {
  if (!search.length) return -1
  const comparable = (line: string): string => line.replace(/^\uFEFF/, '')
  for (let index = 0; index <= lines.length - search.length; index += 1) {
    if (search.every((line, offset) => comparable(lines[index + offset]) === comparable(line))) return index
  }
  return -1
}
