import path from 'node:path'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runWindowsJob } from './windowsJob'
import type { LocalCommand } from './localCommand'

const helper = path.resolve('out/native/JobHost.exe')
const input = (script: string): LocalCommand => ({ executable: process.execPath,
  args: ['-e', script], cwd: process.cwd(), timeoutMs: 3000,
  env: { SYSTEMROOT: process.env.SYSTEMROOT ?? 'C:\\Windows' } })
function alive(pid: number): boolean { try { process.kill(pid, 0); return true } catch { return false } }
async function gone(pid: number) {
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 25))
  expect(alive(pid)).toBe(false)
}

describe.skipIf(process.platform !== 'win32' || !fs.existsSync(helper))('Windows Job Object integration', () => {
  it('runs real executable arguments including quotes and backslashes literally', async () => {
    const command = input('process.stdout.write(process.argv[1])')
    command.args.push('spaces "quotes" \\ & | trailing\\')
    const result = await runWindowsJob(helper, command, new AbortController().signal, () => undefined)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(command.args[2])
  })

  it('reports the real child PID separately from the job host PID', async () => {
    let childPid = 0
    const result = await runWindowsJob(
      helper,
      input('process.stdout.write("started")'),
      new AbortController().signal,
      () => undefined,
      undefined,
      (pid) => { childPid = pid }
    )
    expect(result.exitCode).toBe(0)
    expect(childPid).toBeGreaterThan(0)
  })

  it.each(['cancel', 'crash', 'normal'] as const)('cleans detached descendants on %s', async (mode) => {
    const controller = new AbortController()
    let hostPid = 0, descendant = 0
    const command = input(`const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});console.log(c.pid);c.unref();${mode === 'normal' ? '' : 'setInterval(()=>{},1000)'}`)
    let buffered = ''
    const running = runWindowsJob(helper, command, controller.signal, (_, text) => {
      buffered += text
      if (!descendant && buffered.includes('\n')) {
        descendant = Number(buffered.trim())
        if (mode === 'cancel') controller.abort()
        if (mode === 'crash') process.kill(hostPid, 'SIGKILL')
      }
    }, (pid) => { hostPid = pid })
    if (mode === 'normal') await expect(running).resolves.toMatchObject({ exitCode: 0 })
    else await expect(running).rejects.toThrow()
    expect(descendant).toBeGreaterThan(0)
    await gone(descendant)
  })
})
