import { readdir, rm, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { findDockerExecutable } from './dockerPreflight'
import { runDockerCli } from './dockerProcess'

export interface DockerCleanupResult {
  containersRemoved: number
  runtimeCopiesRemoved: boolean
}

interface CleanupOptions {
  findExecutable?: typeof findDockerExecutable
  runCli?: typeof runDockerCli
  runtimeRoot?: string
  now?: () => number
}

/** Startup-only recovery: before tasks exist, every managed container belongs to an interrupted prior run. */
export async function cleanupInterruptedDockerResources(
  options: CleanupOptions = {}
): Promise<DockerCleanupResult> {
  const runtimeRoot = options.runtimeRoot ?? join(tmpdir(), 'ai-agent-docker-runtime')
  assertRuntimeRoot(runtimeRoot)
  let runtimeCopiesRemoved = false
  try {
    await rm(runtimeRoot, { recursive: true, force: true })
    runtimeCopiesRemoved = true
  } catch { /* A locked copy will be retried on the next startup. */ }

  const executable = await (options.findExecutable ?? findDockerExecutable)()
  if (!executable) return { containersRemoved: 0, runtimeCopiesRemoved }
  const runCli = options.runCli ?? runDockerCli
  const controller = new AbortController()
  const listed = await runCli(
    executable,
    ['ps', '--all', '--quiet', '--filter', 'label=com.ai-agent.managed=true'],
    controller.signal,
    5_000
  ).catch(() => undefined)
  if (!listed || listed.exitCode !== 0) return { containersRemoved: 0, runtimeCopiesRemoved }
  const ids = validContainerIds(listed.stdout)
  if (!ids.length) return { containersRemoved: 0, runtimeCopiesRemoved }
  const removed = await runCli(
    executable, ['rm', '--force', '--volumes', ...ids], controller.signal, 10_000
  ).catch(() => undefined)
  return { containersRemoved: removed?.exitCode === 0 ? ids.length : 0, runtimeCopiesRemoved }
}

/** Periodic recovery removes only labelled resources whose trusted expiry label has elapsed. */
export async function cleanupExpiredDockerResources(options: CleanupOptions = {}): Promise<DockerCleanupResult> {
  const now = (options.now ?? Date.now)()
  const runtimeRoot = options.runtimeRoot ?? join(tmpdir(), 'ai-agent-docker-runtime')
  assertRuntimeRoot(runtimeRoot)
  let runtimeCopiesRemoved = false
  try {
    const entries = await readdir(runtimeRoot, { withFileTypes: true })
    for (const entry of entries.slice(0, 500)) {
      if (!entry.isDirectory() || !/^workspace-[a-f0-9-]{36}$/i.test(entry.name)) continue
      const target = join(runtimeRoot, entry.name)
      const info = await stat(target)
      if (now - info.mtimeMs > 12 * 60 * 60 * 1000) {
        await rm(target, { recursive: true, force: true })
        runtimeCopiesRemoved = true
      }
    }
  } catch { /* Missing, locked, or temporarily unavailable runtime root. */ }

  const executable = await (options.findExecutable ?? findDockerExecutable)()
  if (!executable) return { containersRemoved: 0, runtimeCopiesRemoved }
  const runCli = options.runCli ?? runDockerCli
  const controller = new AbortController()
  const listed = await runCli(executable, [
    'ps', '--all', '--quiet', '--filter', 'label=com.ai-agent.managed=true'
  ], controller.signal, 5_000).catch(() => undefined)
  if (!listed || listed.exitCode !== 0) return { containersRemoved: 0, runtimeCopiesRemoved }
  let containersRemoved = 0
  for (const id of validContainerIds(listed.stdout)) {
    const inspected = await runCli(executable, [
      'inspect', '--format', '{{index .Config.Labels "com.ai-agent.expires-at"}}', id
    ], controller.signal, 5_000).catch(() => undefined)
    const expiresAt = inspected?.exitCode === 0 ? Number(inspected.stdout.trim()) : Number.NaN
    if (!Number.isSafeInteger(expiresAt) || expiresAt > now) continue
    const removed = await runCli(executable, ['rm', '--force', '--volumes', id], controller.signal, 5_000)
      .catch(() => undefined)
    if (removed?.exitCode === 0) containersRemoved += 1
  }
  return { containersRemoved, runtimeCopiesRemoved }
}

export function startDockerCleanupTimer(intervalMs = 30 * 60 * 1000): () => void {
  const timer = setInterval(() => { void cleanupExpiredDockerResources() }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

function assertRuntimeRoot(runtimeRoot: string): void {
  if (basename(runtimeRoot) !== 'ai-agent-docker-runtime') throw new Error('DOCKER_RUNTIME_ROOT_INVALID')
}

function validContainerIds(value: string): string[] {
  return [...new Set(value.split(/\s+/).filter((id) => /^[a-f0-9]{12,64}$/i.test(id)))].slice(0, 100)
}
