export function directoriesToRefresh(changedPaths: string[], loadedDirectories: string[]): string[] {
  const loaded = new Set(['', ...loadedDirectories])
  if (!changedPaths.length) return [...loaded]
  const affected = new Set<string>([''])
  for (const changedPath of changedPaths) {
    const normalized = changedPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const parent = normalized.split('/').slice(0, -1).join('/')
    affected.add(parent)
    for (const directory of loaded) {
      if (!directory || normalized === directory || normalized.startsWith(`${directory}/`)) affected.add(directory)
    }
  }
  return [...affected].filter((directory) => loaded.has(directory))
}

