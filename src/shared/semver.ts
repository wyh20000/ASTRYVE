interface ParsedSemver { core: [number, number, number]; prerelease: string[] }

export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0
  if (!a.prerelease.length) return 1
  if (!b.prerelease.length) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber
    if (leftNumber !== undefined) return -1
    if (rightNumber !== undefined) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

function parseSemver(value: string): ParsedSemver {
  const withoutBuild = value.split('+')[0]
  const separator = withoutBuild.indexOf('-')
  const version = separator < 0 ? withoutBuild : withoutBuild.slice(0, separator)
  const prerelease = separator < 0 ? '' : withoutBuild.slice(separator + 1)
  const core = version.split('.').map((part) => Number(part))
  return {
    core: [core[0] || 0, core[1] || 0, core[2] || 0],
    prerelease: prerelease ? prerelease.split('.') : []
  }
}
