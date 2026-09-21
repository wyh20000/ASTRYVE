import { BrowserGateway } from './browserGateway'
import { ChromeDevtoolsMcpAdapter } from './chromeDevtoolsMcpAdapter'
import {
  createChromeDevtoolsMcpSession,
  type ChromeDevtoolsMcpSession
} from './chromeDevtoolsMcpClient'
import { getBrowserPreferences } from '../settings'

let session: ChromeDevtoolsMcpSession | null = null
let gateway: BrowserGateway | null = null

/** Registers the trusted adapter without prompting Chrome until a browser tool is used. */
export async function initOfficialChromeBrowserRuntime(): Promise<BrowserGateway> {
  await closeOfficialChromeBrowserRuntime()
  const nextSession = new LazyChromeDevtoolsMcpSession(createChromeDevtoolsMcpSession)
  session = nextSession
  gateway = new BrowserGateway(new ChromeDevtoolsMcpAdapter(nextSession), {
    canNavigate: isOriginAllowed
  })
  return gateway
}

export async function closeOfficialChromeBrowserRuntime(): Promise<void> {
  const active = session
  session = null
  gateway = null
  await active?.close()
}

export function getOfficialChromeBrowserGateway(): BrowserGateway | null {
  return gateway
}

export async function testOfficialChromeBrowserConnection(): Promise<number> {
  if (!gateway) throw new Error('浏览器运行时尚未初始化')
  return (await gateway.listTabs()).length
}

export async function disconnectOfficialChromeBrowserRuntime(): Promise<void> {
  if (session instanceof LazyChromeDevtoolsMcpSession) await session.disconnect()
}

function isOriginAllowed(url: URL): boolean {
  const origin = url.origin.toLowerCase()
  const preferences = getBrowserPreferences()
  if (preferences.blockedOrigins.includes(origin)) return false
  return preferences.allowAllSites || preferences.allowedOrigins.includes(origin)
}

export class LazyChromeDevtoolsMcpSession implements ChromeDevtoolsMcpSession {
  private pending: Promise<ChromeDevtoolsMcpSession> | null = null
  private active: ChromeDevtoolsMcpSession | null = null
  private closed = false
  private generation = 0

  constructor(
    private readonly connect: () => Promise<ChromeDevtoolsMcpSession>
  ) {}

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ) {
    const active = await this.ensureConnected()
    return active.callTool(name, args, signal)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.disconnect()
  }

  async disconnect(): Promise<void> {
    this.generation += 1
    const pending = this.pending
    this.pending = null
    const active = this.active ?? await pending?.catch(() => null)
    this.active = null
    await active?.close()
  }

  private ensureConnected(): Promise<ChromeDevtoolsMcpSession> {
    if (this.closed) return Promise.reject(new Error('Chrome DevTools MCP 已关闭'))
    if (this.active) return Promise.resolve(this.active)
    if (!this.pending) {
      const generation = this.generation
      const pending = this.connect()
        .then(async (connected) => {
          if (this.closed || generation !== this.generation) {
            await connected.close()
            throw new Error(this.closed
              ? 'Chrome DevTools MCP 已关闭'
              : 'Chrome DevTools MCP 连接已断开')
          }
          this.active = connected
          return connected
        })
        .catch((error: unknown) => {
          if (this.pending === pending) this.pending = null
          throw error
        })
      this.pending = pending
    }
    return this.pending
  }
}
