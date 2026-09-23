import type { PluginPermission, Session } from '../../../shared/types'
import type { WorkspaceGrant } from '../../../shared/agent'
import { sameProjectPath } from './projectPath'

/** Session ownership, not renderer state or model text, grants access to a project. */
export function isWorkSessionForWorkspace(
  session: Session | null | undefined,
  grant: WorkspaceGrant | undefined,
  workspaceId: string
): boolean {
  return Boolean(session?.kind === 'work' && session.projectPath && grant &&
    grant.id === workspaceId &&
    (!session.workspaceId || session.workspaceId === workspaceId) &&
    sameProjectPath(session.projectPath, grant.rootPath))
}

/** A projectless capability task must not receive local coding permissions from plugins. */
export function isPluginAllowedInChat(permissions: readonly PluginPermission[]): boolean {
  return !permissions.some((permission) => permission === 'workspace.read' ||
    permission === 'workspace.write' || permission === 'process')
}
