import { dirname, posix } from 'node:path'
import type { ToolDefinition } from '../../../shared/agent'
import type { WorkspaceBoundaryService } from './workspace'

const CHECK_NAME = /(?:^|:|-)(test|typecheck|type-check|lint|build|check|verify)(?:$|:|-)/i
const CONFIG_NAME = /^(?:vitest|vite|jest|eslint|webpack|rollup|tsconfig)(?:\.|$)|^(?:pyproject\.toml|pytest\.ini|tox\.ini|Cargo\.toml|Makefile)$/i
const MAX_MANIFESTS = 20

type ServiceProvider = () => WorkspaceBoundaryService

export interface DiscoveredCheck {
  kind: 'test' | 'typecheck' | 'lint' | 'build' | 'check'
  name: string
  source: string
  cwd: string
  executable: 'npm'
  args: string[]
}

export function createScriptDiscoveryTool(service: ServiceProvider): ToolDefinition<Record<string, never>, unknown> {
  return {
    name: 'workspace.discoverChecks', operation: 'fs.read',
    description: 'Discover test, typecheck, lint, build and verification scripts from safe package manifests and report recognized config files. Returns structured process.run arguments.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    validateArgs: (value): value is Record<string, never> => Boolean(value) && typeof value === 'object' &&
      !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0,
    execute: async (_input, context) => {
      try {
        const entries = await service().listFiles(context.workspace.id, '')
        const manifests = entries.filter((entry) => entry.kind === 'file' &&
          posix.basename(entry.path).toLowerCase() === 'package.json').slice(0, MAX_MANIFESTS)
        const checks: DiscoveredCheck[] = []
        for (const manifest of manifests) {
          const file = await service().readFile(context.workspace.id, manifest.path)
          let parsed: unknown
          try { parsed = JSON.parse(file.content) } catch { continue }
          const scripts = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as { scripts?: unknown }).scripts : undefined
          if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) continue
          const cwd = dirname(manifest.path).replaceAll('\\', '/')
          for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
            if (typeof command !== 'string' || !CHECK_NAME.test(name)) continue
            checks.push({
              kind: checkKind(name), name, source: manifest.path, cwd: cwd === '.' ? '' : cwd,
              executable: 'npm', args: ['run', name]
            })
          }
        }
        const configs = entries.filter((entry) => entry.kind === 'file' && CONFIG_NAME.test(posix.basename(entry.path)))
          .map((entry) => entry.path).slice(0, 100)
        return { ok: true, value: { checks, configs, truncated: manifests.length >= MAX_MANIFESTS || configs.length >= 100 } }
      } catch (error) {
        const candidate = error as { code?: unknown; message?: unknown }
        return { ok: false, error: {
          code: typeof candidate?.code === 'string' ? candidate.code : 'CHECK_DISCOVERY_FAILED',
          message: typeof candidate?.message === 'string' ? candidate.message : '项目检查脚本发现失败'
        } }
      }
    }
  }
}

function checkKind(name: string): DiscoveredCheck['kind'] {
  const lower = name.toLowerCase()
  if (lower.includes('type')) return 'typecheck'
  if (lower.includes('lint')) return 'lint'
  if (lower.includes('build')) return 'build'
  if (lower.includes('test')) return 'test'
  return 'check'
}
