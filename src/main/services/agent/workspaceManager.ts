import { getWorkspaceGrants, setWorkspaceGrants } from '../settings'
import {
  WorkspaceBoundaryService,
  type WorkspaceGrantStorage
} from './workspace'
import { sameProjectPath } from './projectPath'
export { sameProjectPath } from './projectPath'

const settingsStorage: WorkspaceGrantStorage = {
  load: getWorkspaceGrants,
  save: setWorkspaceGrants
}

let service: WorkspaceBoundaryService | null = null
const activeWorkspaces = new Map<string, string>()
export function getSessionWorkspaceId(sessionId: string): string | undefined {
  return activeWorkspaces.get(sessionId)
}

/** Restore the in-memory binding from a persisted session path after restart. */
export async function restoreSessionWorkspace(
  sessionId: string,
  projectPath: string | null | undefined,
  workspaceService = getWorkspaceService()
): Promise<string | undefined> {
  const current = activeWorkspaces.get(sessionId)
  if (current) return current
  if (!projectPath) return undefined
  const match = workspaceService.listRecent().find((workspace) =>
    sameProjectPath(workspace.displayPath, projectPath)
  )
  if (!match) return undefined
  await workspaceService.activate(match.id)
  bindSessionWorkspace(sessionId, match.id)
  return match.id
}

const switchListeners = new Set<
  (sessionId: string, previousWorkspaceId: string | undefined, workspaceId: string | undefined) => void
>()

export function initWorkspaceService(): WorkspaceBoundaryService {
  service = new WorkspaceBoundaryService(settingsStorage)
  return service
}

export function getWorkspaceService(): WorkspaceBoundaryService {
  if (!service) throw new Error('Workspace service not initialized')
  return service
}

export async function activateSessionWorkspace(sessionId: string, workspaceId: string) {
  const workspace = await getWorkspaceService().activate(workspaceId)
  bindSessionWorkspace(sessionId, workspaceId)
  return workspace
}

function bindSessionWorkspace(sessionId: string, workspaceId: string): void {
  const previous = activeWorkspaces.get(sessionId)
  activeWorkspaces.set(sessionId, workspaceId)
  if (previous !== workspaceId) {
    for (const listener of switchListeners) listener(sessionId, previous, workspaceId)
  }
}

export function clearSessionWorkspace(sessionId: string): void {
  const previous = activeWorkspaces.get(sessionId)
  activeWorkspaces.delete(sessionId)
  if (previous) {
    for (const listener of switchListeners) listener(sessionId, previous, undefined)
  }
}

export function clearWorkspaceBindings(workspaceId: string): void {
  for (const [sessionId, boundId] of activeWorkspaces) {
    if (boundId === workspaceId) clearSessionWorkspace(sessionId)
  }
}

export function onSessionWorkspaceSwitched(
  listener: (sessionId: string, previousWorkspaceId: string | undefined, workspaceId: string | undefined) => void
): () => void {
  switchListeners.add(listener)
  return () => switchListeners.delete(listener)
}
