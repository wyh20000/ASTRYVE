import { describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext } from '../../../shared/agent'
import { createScriptDiscoveryTool } from './scriptDiscoveryTool'

const context = {
  taskId: 'task', callId: 'call', workspace: { id: 'workspace' }, environment: 'docker',
  permissionMode: 'smart-approval', signal: new AbortController().signal
} as ToolExecutionContext

describe('workspace.discoverChecks', () => {
  it('discovers categorized npm checks and recognized configs without executing scripts', async () => {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ scripts: { test: 'vitest', dev: 'vite', typecheck: 'tsc', 'lint:ci': 'eslint .' } }),
      'packages/app/package.json': JSON.stringify({ scripts: { build: 'vite build', deploy: 'ship' } })
    }
    const service = {
      listFiles: vi.fn(async () => [
        ...Object.keys(files).map((path) => ({ path, name: path.split('/').at(-1)!, kind: 'file' as const })),
        { path: 'vitest.config.mts', name: 'vitest.config.mts', kind: 'file' as const }
      ]),
      readFile: vi.fn(async (_workspaceId: string, path: string) => ({
        path, content: files[path], size: files[path].length, encoding: 'utf-8' as const
      }))
    }
    const result = await createScriptDiscoveryTool(() => service as never).execute({}, context)
    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({
      checks: [
        { kind: 'test', name: 'test', cwd: '', executable: 'npm', args: ['run', 'test'] },
        { kind: 'typecheck', name: 'typecheck' },
        { kind: 'lint', name: 'lint:ci' },
        { kind: 'build', name: 'build', cwd: 'packages/app' }
      ],
      configs: ['vitest.config.mts']
    })
    expect(service.readFile).toHaveBeenCalledTimes(2)
  })

  it('uses a closed empty input schema', () => {
    const tool = createScriptDiscoveryTool(() => ({} as never))
    expect(tool.validateArgs({})).toBe(true)
    expect(tool.validateArgs({ path: '.' })).toBe(false)
  })
})
