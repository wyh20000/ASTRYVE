import { mkdtemp, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cleanupExpiredDockerResources, cleanupInterruptedDockerResources } from './dockerCleanup'

describe('interrupted Docker cleanup', () => {
  it('removes only explicitly labelled container IDs and stale runtime copies', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'docker-cleanup-test-'))
    const runtimeRoot = join(parent, 'ai-agent-docker-runtime')
    await mkdir(join(runtimeRoot, 'workspace-old'), { recursive: true })
    const runCli = vi.fn(async (_exe, args: string[]) => ({
      exitCode: 0, durationMs: 1,
      stdout: args[0] === 'ps' ? '123456789abc\nnot-an-id\nabcdefabcdef\n' : '',
      stderr: '', truncated: false
    }))
    await expect(cleanupInterruptedDockerResources({
      runtimeRoot, findExecutable: async () => 'docker', runCli
    })).resolves.toEqual({ containersRemoved: 2, runtimeCopiesRemoved: true })
    await expect(stat(runtimeRoot)).rejects.toThrow()
    expect(runCli.mock.calls[0][1]).toEqual([
      'ps', '--all', '--quiet', '--filter', 'label=com.ai-agent.managed=true'
    ])
    expect(runCli.mock.calls[1][1]).toEqual(['rm', '--force', '--volumes', '123456789abc', 'abcdefabcdef'])
  })
})

describe('expired Docker cleanup', () => {
  it('removes only managed containers with an elapsed trusted expiry label', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'docker-cleanup-test-'))
    const runtimeRoot = join(parent, 'ai-agent-docker-runtime')
    await mkdir(runtimeRoot)
    const runCli = vi.fn(async (_exe, args: string[]) => ({
      exitCode: 0, durationMs: 1,
      stdout: args[0] === 'ps' ? '111111111111\n222222222222\n333333333333\n'
        : args[0] === 'inspect' && args.at(-1) === '111111111111' ? '999\n'
          : args[0] === 'inspect' && args.at(-1) === '222222222222' ? '1001\n' : 'invalid\n',
      stderr: '', truncated: false
    }))
    await expect(cleanupExpiredDockerResources({
      runtimeRoot, findExecutable: async () => 'docker', runCli, now: () => 1000
    })).resolves.toEqual({ containersRemoved: 1, runtimeCopiesRemoved: false })
    expect(runCli.mock.calls.filter((call) => call[1][0] === 'rm').map((call) => call[1].at(-1)))
      .toEqual(['111111111111'])
  })
})
