/** Compare trusted project paths without loading workspace settings or services. */
export function sameProjectPath(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight
}
