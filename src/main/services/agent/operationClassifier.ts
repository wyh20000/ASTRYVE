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
  toolName?: string,
  externalTarget?: import('../../../shared/agent').TrustedExternalTarget
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
    case 'external.call':
      return normalizeExternalTarget(externalTarget, toolName)
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

function normalizeExternalTarget(
  target: import('../../../shared/agent').TrustedExternalTarget | undefined,
  registeredToolName: string | undefined
): NormalizedOperationTarget {
  if (!target) throw new OperationClassificationError('external.call requires trusted metadata')
  let origin: URL
  try { origin = new URL(target.serverOrigin) } catch { throw new OperationClassificationError('trusted external origin is invalid') }
  if (origin.protocol !== 'https:' || origin.origin !== target.serverOrigin || origin.pathname !== '/' || origin.search || origin.hash ||
      !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(target.pluginId) ||
      !/^[a-z][a-z0-9._-]{0,63}$/.test(target.serverId) ||
      !/^sha256:[a-f0-9]{64}$/.test(target.connectionIdHash) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(target.toolName) ||
      registeredToolName !== `mcp__${target.pluginId}__${target.serverId}__${target.toolName}` ||
      (target.accountLabel !== undefined && (!target.accountLabel.trim() || target.accountLabel.length > 100 || /[\u0000-\u001f]/.test(target.accountLabel)))) {
    throw new OperationClassificationError('trusted external metadata is invalid')
  }
  return { type: 'external', ...target, serverOrigin: origin.origin }
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
