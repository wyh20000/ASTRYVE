import path from 'node:path'
import type {
  NormalizedOperationTarget,
  OperationKind,
  WorkspaceGrant
} from '../../../shared/agent'
import { normalizeCommand } from './commandPolicy'

const SENSITIVE_PATH = /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.git-credentials|\.npmrc|\.ssh|credentials?)(?:[\\/]|$)/i

export class OperationClassificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperationClassificationError'
  }
}

/** Converts validated tool arguments into a trusted, deterministic policy target. */
export function classifyOperation(
  operation: OperationKind,
  input: unknown,
  workspace: WorkspaceGrant,
  toolName?: string
): NormalizedOperationTarget {
  const args = asRecord(input)
  switch (operation) {
    case 'process.run': {
      const classified = normalizeCommand(args, workspace)
      return { type: 'command', ...classified }
    }
    case 'process.start': {
      const classified = normalizeCommand(args, workspace)
      return {
        type: 'command',
        ...classified,
        signals: { ...classified.signals, longRunning: true }
      }
    }
    case 'process.stop':
      return { type: 'service-stop', serviceId: requireString(args.serviceId, 'serviceId') }
    case 'network.enable': {
      const rawUrl = requireString(args.url, 'url')
      let url: URL
      try {
        url = new URL(rawUrl)
      } catch {
        throw new OperationClassificationError('Network target URL is invalid')
      }
      return {
        type: 'network',
        protocol: url.protocol === 'http:' || url.protocol === 'https:' ? url.protocol : 'other',
        host: url.host.toLowerCase(),
        scope: args.scope === 'task' ? 'task' : args.scope === 'once' ? 'once' : (() => {
          throw new OperationClassificationError('Network scope is invalid')
        })()
      }
    }
    case 'browser.read':
    case 'browser.interact': {
      const rawUrl = typeof args.url === 'string' ? args.url : 'https://browser.local/'
      let origin = 'browser://local'
      try {
        const url = new URL(rawUrl)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
        origin = url.origin.toLowerCase()
      } catch {
        if (rawUrl !== 'https://browser.local/') throw new OperationClassificationError('Browser target URL is invalid')
      }
      return {
        type: 'browser', action: resolveBrowserAction(toolName, operation), origin,
        tabId: typeof args.tabId === 'string' ? args.tabId.slice(0, 200) : undefined,
        write: operation === 'browser.interact',
        sensitive: Boolean(args.sensitive) || toolName === 'browser.confirmClick'
      }
    }
    case 'git.read':
    case 'git.write':
      return {
        type: 'git',
        action: resolveGitAction(args.action, toolName),
        write: operation === 'git.write'
      }
    case 'fs.apply-host': {
      const paths = requireStringArray(args.paths, 'paths').map((item) =>
        normalizeWorkspacePath(workspace, item)
      )
      return {
        type: 'host-patch',
        paths: paths.map((item) => item.path),
        patchHash: requireHash(args.patchHash),
        outsideWorkspace: paths.some((item) => item.outsideWorkspace)
      }
    }
    case 'fs.read':
    case 'fs.search':
    case 'fs.patch': {
      const normalized = normalizeWorkspacePath(
        workspace,
        typeof args.path === 'string' ? args.path : '.'
      )
      return {
        type: 'file',
        ...normalized,
        sensitive: SENSITIVE_PATH.test(normalized.path),
        destructive: operation === 'fs.patch' && Boolean(args.destructive),
        binary: Boolean(args.binary)
      }
    }
  }
}

function resolveBrowserAction(toolName: string | undefined, operation: 'browser.read' | 'browser.interact'): string {
  if (toolName?.startsWith('browser.') && toolName.length > 'browser.'.length) {
    return toolName.slice('browser.'.length).toLowerCase()
  }
  return operation === 'browser.read' ? 'read' : 'interact'
}

function resolveGitAction(value: unknown, toolName?: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim().toLowerCase()
  if (toolName?.startsWith('git.') && toolName.length > 4) return toolName.slice(4).toLowerCase()
  throw new OperationClassificationError('action is invalid')
}

export function serializeOperationTarget(target: NormalizedOperationTarget): string {
  return stableStringify(target)
}

function normalizeWorkspacePath(
  workspace: WorkspaceGrant,
  requestedPath: string
): { path: string; outsideWorkspace: boolean } {
  if (requestedPath.includes('\0')) {
    throw new OperationClassificationError('Path contains an invalid null byte')
  }
  const root = path.resolve(workspace.realRootPath)
  const target = path.resolve(root, requestedPath)
  const relative = path.relative(root, target)
  const outsideWorkspace = relative.startsWith('..') || path.isAbsolute(relative)
  return { path: target, outsideWorkspace }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperationClassificationError('Operation target must be an object')
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 8_192) {
    throw new OperationClassificationError(`${field} is invalid`)
  }
  return value
}

function requireStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 1_000 ||
    !value.every((item) => typeof item === 'string' && item.length <= 8_192)
  ) {
    throw new OperationClassificationError(`${field} is invalid`)
  }
  return value
}

function requireHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new OperationClassificationError('patchHash must be a SHA-256 digest')
  }
  return value.toLowerCase()
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
