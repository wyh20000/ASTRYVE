import { describe, expect, it } from 'vitest'
import { runLocalCommand, validateLocalCommand, type LocalCommand } from './localCommand'

const command = (code: string): LocalCommand => ({
  executable: process.execPath, args: ['-e', code], cwd: process.cwd(), timeoutMs: 3000,
  env: process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT ?? 'C:\\Windows' } : {}
})

describe('local command worker primitive', () => {
  it('runs a real child process with separate output streams and no inherited secrets', async () => {
    const output: string[] = []
    const result = await runLocalCommand(command('process.stdout.write("hello"); process.stderr.write("error"); process.stdout.write(String(process.env.AGENT_TEST_SECRET ?? "absent"))'),
      new AbortController().signal, (_, text) => output.push(text))
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('helloabsent')
    expect(result.stderr).toBe('error')
    expect(output.join('')).toContain('hello')
  })
  it('does not interpret shell metacharacters in argv', async () => {
    const input = command('process.stdout.write(process.argv[1])')
    input.args.push('hello && not-a-command')
    const result = await runLocalCommand(input, new AbortController().signal, () => undefined)
    expect(result.stdout).toBe('hello && not-a-command')
  })
  it('terminates a direct child when cancelled', async () => {
    const controller = new AbortController()
    await expect(runLocalCommand(command('process.stdout.write("ready");setInterval(()=>{},1000)'),
      controller.signal, () => controller.abort())).rejects.toThrow('COMMAND_CANCELLED')
  })
  it('times out a nonresponsive direct child', async () => {
    await expect(runLocalCommand({ ...command('setInterval(()=>{},1000)'), timeoutMs: 100 },
      new AbortController().signal, () => undefined)).rejects.toThrow('COMMAND_TIMEOUT')
  })
  it('caps output while continuing to drain the child pipes', async () => {
    const result = await runLocalCommand(command('process.stdout.write("x".repeat(2*1024*1024))'),
      new AbortController().signal, () => undefined)
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.stdout)).toBe(1024 * 1024)
  })
  it('rejects raw executable strings, scripts, and injected runtime environment variables', () => {
    expect(() => validateLocalCommand({ ...command(''), executable: 'node -e hi' })).toThrow('INVALID_COMMAND')
    expect(() => validateLocalCommand({ ...command(''), executable: 'C:/test.cmd' })).toThrow('INVALID_COMMAND')
    expect(() => validateLocalCommand({ ...command(''), env: { NODE_OPTIONS: '--require evil.js' } })).toThrow('INVALID_COMMAND')
  })
})
