import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { AuditEvent, WorkspaceGrant } from '../../../shared/agent'
import type { SkillMetadata } from '../../../shared/types'
import { getDisabledSkillIds } from '../settings'
import { SkillRegistry, type ResolvedSkills } from './skillRegistry'
import { listEnabledPluginSkillRoots } from './pluginManager'
import { getToolRegistry, writeAgentAudit } from './taskRuntimeManager'

let registry: SkillRegistry | undefined
let installedRoot: string | undefined

export function initSkillRegistry(userDataPath: string): void {
  installedRoot = join(userDataPath, 'skills')
  registry = new SkillRegistry(installedRoot, getDisabledSkillIds, {
    codexRoot: join(homedir(), '.codex', 'skills'),
    agentsRoot: join(homedir(), '.agents', 'skills'),
    pluginRoots: listEnabledPluginSkillRoots
  })
}

export function getInstalledSkillRoot(): string {
  if (!installedRoot) throw new Error('Skill registry not initialized')
  return installedRoot
}

export async function listSkills(workspace?: WorkspaceGrant): Promise<SkillMetadata[]> {
  return requireRegistry().list(workspace, availableTools())
}

export async function resolveSkills(
  request: string,
  explicitIds: readonly string[],
  workspace?: WorkspaceGrant
): Promise<ResolvedSkills> {
  return requireRegistry().resolve(request, explicitIds, workspace, availableTools())
}

export function auditSkillUse(taskId: string, workspaceId: string, skills: SkillMetadata[]): void {
  for (const skill of skills) {
    const event: AuditEvent = {
      id: randomUUID(), taskId, workspaceId, timestamp: Date.now(), actor: 'system',
      action: 'skill.use', outcome: 'success', risk: 'low', reasonCode: `source.${skill.source}`,
      target: `${skill.id}@${skill.version ?? 'local'}`
    }
    writeAgentAudit(event)
    for (const resource of skill.resources) {
      writeAgentAudit({
        id: randomUUID(), taskId, workspaceId, timestamp: Date.now(), actor: 'system',
        action: 'skill.resource', outcome: 'success', risk: 'low', reasonCode: `source.${skill.source}`,
        target: `${skill.id}@${skill.version ?? 'local'}:resource:${resource}`
      })
    }
  }
}

function availableTools(): Set<string> {
  return new Set(getToolRegistry().list().map((tool) => tool.name))
}

function requireRegistry(): SkillRegistry {
  if (!registry) throw new Error('Skill registry not initialized')
  return registry
}
