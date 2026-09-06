import { access, realpath } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import type { DockerImageOption, DockerPreflightStatus } from '../../../shared/types'
import { BUILTIN_DOCKER_IMAGE } from './dockerCommand'

interface CommandResult { exitCode: number; stdout: string; stderr: string }
export type DockerCommandRunner = (executable: string, args: string[]) => Promise<CommandResult>

export async function runDockerPreflight(
  options: { findExecutable?: () => Promise<string | undefined>; run?: DockerCommandRunner; now?: () => number } = {}
): Promise<DockerPreflightStatus> {
  const checkedAt = (options.now ?? Date.now)()
  const executable = await (options.findExecutable ?? findDockerExecutable)()
  const base = {
    checkedAt, cliFound: Boolean(executable), localContext: false, daemonReachable: false, linuxContainers: false,
    diskChecked: false, imageReference: BUILTIN_DOCKER_IMAGE, imagePresent: false, images: [] as DockerImageOption[]
  }
  if (!executable) return { ...base, ready: false, reason: '未找到受信任的 Docker CLI' }
  const run = options.run ?? runDockerCommand

  const version = await safely(run, executable, ['--version'])
  const clientVersion = version.exitCode === 0 ? parseClientVersion(version.stdout) : undefined
  const context = await safely(run, executable, ['context', 'show'])
  const contextName = context.exitCode === 0 ? context.stdout.trim().slice(0, 128) : undefined
  const endpointResult = contextName
    ? await safely(run, executable, ['context', 'inspect', contextName, '--format', '{{json .Endpoints.docker.Host}}'])
    : { exitCode: -1, stdout: '', stderr: 'Docker context unavailable' }
  const endpoint = endpointResult.exitCode === 0 ? parseJsonString(endpointResult.stdout) : undefined
  const localContext = Boolean(endpoint && /^(?:npipe|unix):\/\//i.test(endpoint))
  if (!localContext) {
    return {
      ...base, clientVersion, contextName, ready: false,
      reason: endpoint ? 'Docker 当前连接到远程 daemon，出于安全原因已禁用' : '无法确认 Docker daemon 为本机环境'
    }
  }
  const info = await safely(run, executable, ['info', '--format', '{{json .}}'])
  if (info.exitCode !== 0) {
    return {
      ...base, clientVersion, contextName, localContext, ready: false,
      reason: conciseFailure('Docker daemon 不可访问', info.stderr)
    }
  }
  const daemon = parseJsonObject(info.stdout)
  if (!daemon) {
    return { ...base, clientVersion, contextName, localContext, daemonReachable: true, ready: false, reason: 'Docker daemon 返回了无效状态' }
  }
  const operatingSystem = stringField(daemon.OperatingSystem) ?? stringField(daemon.OSType)
  const linuxContainers = String(daemon.OSType ?? '').toLowerCase() === 'linux'
  const serverVersion = stringField(daemon.ServerVersion)
  if (!linuxContainers) {
    return {
      ...base, clientVersion, contextName, localContext, daemonReachable: true, serverVersion, operatingSystem,
      ready: false, reason: 'Docker 当前不是 Linux container 模式'
    }
  }

  const [disk, image, imageList] = await Promise.all([
    safely(run, executable, ['system', 'df', '--format', '{{json .}}']),
    safely(run, executable, ['image', 'inspect', BUILTIN_DOCKER_IMAGE, '--format', '{{json .}}']),
    safely(run, executable, ['image', 'ls', '--no-trunc', '--format', '{{json .}}'])
  ])
  const diskChecked = disk.exitCode === 0
  const diskSummary = diskChecked ? summarizeDisk(disk.stdout) : undefined
  const imageInfo = image.exitCode === 0 ? parseJsonObject(image.stdout) : undefined
  const imagePresent = Boolean(imageInfo)
  const imageDigest = imageInfo ? firstDigest(imageInfo.RepoDigests) ?? stringField(imageInfo.Id) : undefined
  const images = imageList.exitCode === 0 ? parseLocalImages(imageList.stdout) : []
  let reason = 'Docker 环境预检通过，沙箱执行后端尚未启用'
  if (!diskChecked) reason = conciseFailure('无法读取 Docker 磁盘状态', disk.stderr)
  else if (!imagePresent) reason = `内置沙箱镜像未安装：${BUILTIN_DOCKER_IMAGE}`
  return {
    ...base, clientVersion, contextName, localContext, daemonReachable: true, serverVersion, operatingSystem,
    linuxContainers: true, diskChecked, diskSummary, imagePresent, imageDigest, images,
    ready: diskChecked && imagePresent, reason
  }
}

function parseLocalImages(value: string): DockerImageOption[] {
  const result: DockerImageOption[] = []
  const seen = new Set<string>()
  for (const line of value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 200)) {
    const image = parseJsonObject(line)
    const imageId = image && stringField(image.ID)
    const repository = image && stringField(image.Repository)
    const tag = image && stringField(image.Tag)
    if (!imageId || !/^sha256:[a-f0-9]{64}$/i.test(imageId) || !repository || repository === '<none>' ||
        !tag || tag === '<none>' || seen.has(imageId)) continue
    seen.add(imageId)
    const digest = stringField(image.Digest)
    result.push({
      imageId: imageId.toLowerCase(), repository, tag,
      digest: digest && /^sha256:[a-f0-9]{64}$/i.test(digest) ? digest.toLowerCase() : undefined,
      source: 'local'
    })
    if (result.length >= 50) break
  }
  return result
}

export async function findDockerExecutable(): Promise<string | undefined> {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe', 'C:\\Program Files\\Docker\\cli-plugins\\docker.exe']
    : process.platform === 'darwin'
      ? ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker']
      : ['/usr/bin/docker', '/usr/local/bin/docker']
  for (const candidate of candidates) {
    try {
      await access(candidate)
      const resolved = await realpath(candidate)
      if (basename(resolved).toLowerCase() === (process.platform === 'win32' ? 'docker.exe' : 'docker')) return resolved
    } catch { /* Continue through the fixed trusted locations. */ }
  }
  return undefined
}

async function runDockerCommand(executable: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      shell: false, windowsHide: true,
      env: dockerCliEnvironment()
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const collect = (current: string, chunk: Buffer): string => (current + chunk.toString('utf8')).slice(-32_768)
    child.stdout.on('data', (chunk: Buffer) => { stdout = collect(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = collect(stderr, chunk) })
    child.once('error', (error) => finish({ exitCode: -1, stdout, stderr: error.message }))
    child.once('close', (code) => finish({ exitCode: code ?? -1, stdout, stderr }))
    const timer = setTimeout(() => {
      child.kill()
      finish({ exitCode: -1, stdout, stderr: 'DOCKER_PREFLIGHT_TIMEOUT' })
    }, 4_000)
  })
}

async function safely(run: DockerCommandRunner, executable: string, args: string[]): Promise<CommandResult> {
  try { return await run(executable, args) } catch (error) {
    return { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value.trim())
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch { return undefined }
}

function parseJsonString(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value.trim())
    return typeof parsed === 'string' && parsed.length <= 1024 ? parsed : undefined
  } catch { return undefined }
}

export function dockerCliEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

function parseClientVersion(value: string): string | undefined {
  return /Docker version\s+([^,\s]+)/i.exec(value)?.[1]
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 512 ? value : undefined
}

function firstDigest(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const digest = value.find((item) => typeof item === 'string' && item.includes('@sha256:'))
  return typeof digest === 'string' ? digest.slice(digest.indexOf('@') + 1) : undefined
}

function summarizeDisk(value: string): string | undefined {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4)
  if (!lines.length) return 'Docker 未报告已用空间'
  return lines.join('；').slice(0, 1024)
}

function conciseFailure(prefix: string, detail: string): string {
  const clean = detail.replace(/\s+/g, ' ').trim().slice(0, 180)
  return clean ? `${prefix}：${clean}` : prefix
}
