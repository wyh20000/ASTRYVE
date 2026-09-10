import type { BrowserStatus, BrowserTab } from '../../../shared/browser'
import { BrowserGateway } from './browserGateway'
import { ChromeCdpAdapter } from './chromeAdapter'
import { ChromeProcessManager } from './chromeProcess'
import { getBrowserPreferences } from '../settings'

let chrome: ChromeProcessManager | undefined
let gateway: BrowserGateway | undefined

export function initBrowserService(userDataPath: string): void {
  chrome?.stop()
  chrome = new ChromeProcessManager(userDataPath)
  gateway = new BrowserGateway(new ChromeCdpAdapter(() => chrome?.getEndpoint()), {
    canNavigate: (url) => !getBrowserPreferences().blockedOrigins.includes(url.origin.toLowerCase())
  })
}
export function browserStatus(): BrowserStatus { return requireChrome().status() }
export async function startBrowser(): Promise<BrowserStatus> { return await requireChrome().start() }
export function stopBrowser(): BrowserStatus { return requireChrome().stop() }
export async function restartBrowser(): Promise<BrowserStatus> { return await requireChrome().restart() }
export async function clearBrowserProfile(): Promise<BrowserStatus> { return requireChrome().clearProfile() }
export async function listBrowserTabs(): Promise<BrowserTab[]> { return requireGateway().listTabs() }
export function getBrowserGateway(): BrowserGateway { return requireGateway() }
export function getBrowserGatewayIfReady(): BrowserGateway | undefined { return gateway }
export function shutdownBrowser(): void { chrome?.stop() }
function requireChrome(): ChromeProcessManager { if (!chrome) throw new Error('浏览器服务尚未初始化'); return chrome }
function requireGateway(): BrowserGateway { if (!gateway) throw new Error('浏览器服务尚未初始化'); return gateway }
