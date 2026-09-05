import { getWorkspaceGrants, setWorkspaceGrants } from '../settings'
import {
  WorkspaceBoundaryService,
  type WorkspaceGrantStorage
} from './workspace'

const settingsStorage: WorkspaceGrantStorage = {
  load: getWorkspaceGrants,
  save: setWorkspaceGrants
}

let service: WorkspaceBoundaryService | null = null
const activeWorkspaces = new Map<string, string>()
export function getSessionWorkspaceId(sessionId: string): string | undefined {
  return activeWorkspaces.get(sessionId)
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
  const previous = activeWorkspaces.get(sessionId)
  activeWorkspaces.set(sessionId, workspaceId)
  if (previous !== workspaceId) {
    for (const listener of switchListeners) listener(sessionId, previous, workspaceId)
  }
  return workspace
}

export function clearSessionWorkspace(sessionId: string): void {
  const previous = activeWorkspaces.get(sessionId)
  activeWorkspaces.delete(sessionId)
  if (previous) {
    for (const listener of switchListeners) listener(sessionId, previous, undefined)
  }
}

export function onSessionWorkspaceSwitched(
  listener: (sessionId: string, previousWorkspaceId: string | undefined, workspaceId: string | undefined) => void
): () => void {
  switchListeners.add(listener)
  return () => switchListeners.delete(listener)
}
