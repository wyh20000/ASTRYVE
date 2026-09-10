import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ChromeProcessManager, chromeCandidates } from './chromeProcess'

describe('ChromeProcessManager', () => {
  it('uses a dedicated profile and an ephemeral debugging port', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chrome-process-'))
    const child = Object.assign(new EventEmitter(), { pid: 123, kill: vi.fn(() => true) })
    const spawn = vi.fn(() => child as never)
    const manager = new ChromeProcessManager(root, {
      platform: 'win32', exists: () => true, spawn, waitForEndpoint: vi.fn(async () => 'http://127.0.0.1:9222')
    })
    const status = await manager.start()
    expect(status.running).toBe(true)
    expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${join(root, 'browser', 'chrome-profile')}`
    ]), expect.objectContaining({ shell: false }))
  })

  it('never includes the normal Chrome profile among candidates', () => {
    expect(chromeCandidates('win32', { LOCALAPPDATA: 'C:\\Users\\Me\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files' }))
      .toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  })
})
