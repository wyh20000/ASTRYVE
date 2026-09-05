import { access } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'

export const LOCAL_EXECUTABLES = ['git', 'node', 'npm', 'python', 'python3', 'py'] as const
export type LocalExecutableName = (typeof LOCAL_EXECUTABLES)[number]

export interface ResolvedExecutable {
  executable: string
  prefixArgs: string[]
  trustedPathEntries: string[]
}

export type HostPathLookup = (fileNames: string[]) => Promise<string | undefined>

/** Resolve only a fixed logical allowlist. Model-provided absolute paths are never executed. */
export async function resolveTrustedExecutable(
  name: LocalExecutableName,
  lookup: HostPathLookup = findOnHostPath
): Promise<ResolvedExecutable> {
  if (!(LOCAL_EXECUTABLES as readonly string[]).includes(name)) {
    throw new Error('EXECUTABLE_NOT_ALLOWED')
  }

  if (name === 'npm') {
    const [node, npm] = await Promise.all([
      lookup(process.platform === 'win32' ? ['node.exe'] : ['node']),
      lookup(process.platform === 'win32' ? ['npm.cmd'] : ['npm'])
    ])
    if (!node || !npm) throw new Error('EXECUTABLE_NOT_FOUND:npm')
    const npmCli = join(dirname(npm), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    await access(npmCli).catch(() => { throw new Error('EXECUTABLE_NOT_FOUND:npm') })
    return { executable: node, prefixArgs: [npmCli], trustedPathEntries: [dirname(node)] }
  }

  const candidates = process.platform === 'win32'
    ? name === 'python3' ? ['python3.exe', 'python.exe']
      : name === 'py' ? ['py.exe']
        : [`${name}.exe`]
    : [name]
  const executable = await lookup(candidates)
  if (!executable) throw new Error(`EXECUTABLE_NOT_FOUND:${name}`)
  return { executable, prefixArgs: [], trustedPathEntries: [dirname(executable)] }
}

export async function findOnHostPath(fileNames: string[]): Promise<string | undefined> {
  const pathValue = process.env.Path ?? process.env.PATH ?? ''
  const entries = pathValue.split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter((entry) => entry && isAbsolute(entry))
  for (const entry of entries) {
    for (const fileName of fileNames) {
      const candidate = resolve(entry, fileName)
      try {
        await access(candidate)
        return candidate
      } catch {
        // Continue through the host PATH without invoking a shell or project binary.
      }
    }
  }
  return undefined
}
