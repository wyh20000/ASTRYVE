import type { WorkspaceSummary } from '@shared/agent'
import type { Session } from '@shared/types'

export function normalizedProjectPath(value: string): string {
  return value.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLocaleLowerCase('en-US')
}

export function sameProjectPath(left: string, right: string): boolean {
  return normalizedProjectPath(left) === normalizedProjectPath(right)
}

/** A missing or changed grant must never silently select an unrelated project. */
export function currentWorkProject(session: Session | undefined, recent: readonly WorkspaceSummary[]): string | null {
  if (session?.kind !== 'work' || !session.projectPath) return null
  const projectPath = session.projectPath
  return recent.find((workspace) =>
    (!session.workspaceId || workspace.id === session.workspaceId) &&
    sameProjectPath(workspace.displayPath, projectPath))?.id ?? null
}

export function createSessionInCurrentSpace(
  session: Session | undefined,
  recent: readonly WorkspaceSummary[],
  actions: { createChat: () => Promise<unknown>; createWork: (workspaceId: string) => Promise<unknown>;
    selectAndCreateWork: () => Promise<unknown> }
): Promise<unknown> {
  if (session?.kind !== 'work') return actions.createChat()
  const workspaceId = currentWorkProject(session, recent)
  return workspaceId ? actions.createWork(workspaceId) : actions.selectAndCreateWork()
}
