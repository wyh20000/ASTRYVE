import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserStatus } from '../../../shared/browser'

interface ChromeDependencies {
  platform: NodeJS.Platform
  exists: (path: string) => boolean
  spawn: typeof spawn
  waitForEndpoint: (profile: string, signal: AbortSignal) => Promise<string>
  killTree?: (child: ChildProcess) => void
}

export class ChromeProcessManager {
  private child?: ChildProcess
  private endpoint?: string
  private executable?: string
  readonly profilePath: string
  constructor(private readonly dataRoot: string, private readonly deps: ChromeDependencies = defaults()) {
    this.profilePath = join(dataRoot, 'browser', 'chrome-profile')
  }

  status(): BrowserStatus {
    const executable = this.executable ?? chromeCandidates(this.deps.platform, process.env).find(this.deps.exists)
    return { available: Boolean(executable), running: Boolean(this.child && !this.child.killed), executable, profilePath: this.profilePath,
      reason: executable ? undefined : '未检测到受支持的 Google Chrome' }
  }

  async start(): Promise<BrowserStatus & { endpoint?: string }> {
    if (this.child && !this.child.killed && this.endpoint) return { ...this.status(), endpoint: this.endpoint }
    const executable = chromeCandidates(this.deps.platform, process.env).find(this.deps.exists)
    if (!executable) return this.status()
    await mkdir(this.profilePath, { recursive: true })
    await rm(join(this.profilePath, 'DevToolsActivePort'), { force: true }).catch(() => undefined)
    const child = this.deps.spawn(executable, [
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${this.profilePath}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-mode', 'about:blank'
    ], { shell: false, windowsHide: false, stdio: 'ignore', env: chromeEnvironment(process.env) })
    this.child = child
    this.executable = executable
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    child.once('exit', () => { this.child = undefined; this.endpoint = undefined })
    try { this.endpoint = await this.deps.waitForEndpoint(this.profilePath, controller.signal) }
    catch (error) { this.stop(); throw error }
    finally { clearTimeout(timer) }
    return { ...this.status(), endpoint: this.endpoint }
  }

  stop(): BrowserStatus {
    if (this.child) {
      if (this.deps.killTree) this.deps.killTree(this.child)
      else this.child.kill()
    }
    this.child = undefined
    this.endpoint = undefined
    return this.status()
  }

  async restart(): Promise<BrowserStatus & { endpoint?: string }> { this.stop(); return this.start() }

  async clearProfile(): Promise<BrowserStatus> {
    if (this.child && !this.child.killed) throw new Error('请先关闭独立 Chrome')
    const expected = join(this.dataRoot, 'browser', 'chrome-profile')
    if (this.profilePath !== expected) throw new Error('浏览器资料目录边界无效')
    await rm(this.profilePath, { recursive: true, force: true })
    return this.status()
  }

  getEndpoint(): string | undefined { return this.endpoint }
}

function chromeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ASAR
  delete env.NODE_OPTIONS
  return env
}

export function chromeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') return [
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.PROGRAMFILES && join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] && join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter((value): value is string => Boolean(value))
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']
}

function defaults(): ChromeDependencies {
  return {
    platform: process.platform, exists: existsSync, spawn, waitForEndpoint,
    killTree: (child) => killChromeTree(child, process.platform)
  }
}

function killChromeTree(child: ChildProcess, platform: NodeJS.Platform): void {
  if (platform !== 'win32' || !child.pid) { child.kill(); return }
  const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
    shell: false, windowsHide: true, stdio: 'ignore', env: chromeEnvironment(process.env)
  })
  killer.once('error', () => child.kill())
}

async function waitForEndpoint(profile: string, signal: AbortSignal): Promise<string> {
  const file = join(profile, 'DevToolsActivePort')
  while (!signal.aborted) {
    try {
      const [port] = (await readFile(file, 'utf8')).split(/\r?\n/)
      if (/^\d{2,5}$/.test(port)) return `http://127.0.0.1:${port}`
    } catch { /* Chrome has not written the port yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('独立 Chrome 启动超时')
}
