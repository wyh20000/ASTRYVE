import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WorkspaceGrant } from '../../../shared/agent'
import { CommandPolicyError, normalizeCommand } from './commandPolicy'

const workspace: WorkspaceGrant = {
  id: 'workspace-1',
  rootPath: path.resolve('C:/project'),
  realRootPath: path.resolve('C:/project'),
  createdAt: 1
}

describe('normalizeCommand', () => {
  it('normalizes structured argv, cwd, env and timeout', () => {
    const result = normalizeCommand(
      {
        executable: 'vitest',
        args: ['run'],
        cwd: 'packages/app',
        env: { CI: '1' },
        timeoutMs: 30_000
      },
      workspace
    )

    expect(result.command).toEqual({
      executable: 'vitest',
      args: ['run'],
      cwd: path.resolve(workspace.realRootPath, 'packages/app'),
      env: { CI: '1' },
      timeoutMs: 30_000
    })
    expect(result.signals.deterministicCheck).toBe(true)
  })

  it('rejects raw shell strings and shell executables', () => {
    expect(() => normalizeCommand('npm test && del *', workspace)).toThrowError(
      new CommandPolicyError('INVALID_COMMAND', 'Command must use executable and argv fields')
    )
    expect(() =>
      normalizeCommand({ executable: 'npm test', args: [] }, workspace)
    ).toThrowError(CommandPolicyError)

    const shell = normalizeCommand(
      { executable: 'powershell.exe', args: ['-Command', 'Get-ChildItem'] },
      workspace
    )
    expect(shell.signals.shellInterpreter).toBe(true)
  })

  it('rejects cwd escape and sensitive environment injection', () => {
    expect(() =>
      normalizeCommand({ executable: 'node', args: [], cwd: '..' }, workspace)
    ).toThrowError(/outside the workspace/)
    expect(() =>
      normalizeCommand({ executable: 'node', args: [], env: { API_KEY: 'secret' } }, workspace)
    ).toThrowError(/non-sensitive environment/)
  })

  it.each([
    [{ executable: 'rm', args: ['-rf', '*'] }, 'destructive'],
    [{ executable: 'npm', args: ['install', 'left-pad'] }, 'dependencyChange'],
    [{ executable: 'npm', args: ['run', 'dev'] }, 'longRunning'],
    [{ executable: 'node', args: ['read.js', '.env'] }, 'credentialAccess'],
    [{ executable: 'node', args: ['a.js', '>', 'out.txt'] }, 'shellSyntax']
  ] as const)('detects the %s risk signal', (input, signal) => {
    expect(normalizeCommand(input, workspace).signals[signal]).toBe(true)
  })
})
