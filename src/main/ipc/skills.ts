import { dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { SkillInstallInput, SkillListInput, SkillToggleInput, SkillUninstallInput } from '@shared/types'
import { assertTrustedIpcSender } from './validation'
import { err, ok } from './result'
import { getWorkspaceService } from '../services/agent/workspaceManager'
import { getInstalledSkillRoot, listSkills } from '../services/agent/skillManager'
import { setSkillEnabled } from '../services/settings'
import { importSkillDirectory, installSkillFromGitHub, listSkillCatalog, uninstallSkill } from '../services/agent/skillInstaller'

export function registerSkillsIpc(): void {
  ipcMain.handle(IPC.skills.list, async (event, input?: SkillListInput) => {
    try {
      assertTrustedIpcSender(event)
      return ok(await listSkills(resolveWorkspace(input?.workspaceId)))
    } catch (error) {
      return err('SKILL_LIST_ERR', error instanceof Error ? error.message : 'Skills 加载失败')
    }
  })

  ipcMain.handle(IPC.skills.catalog, async (event, input?: { query?: unknown }) => {
    try {
      assertTrustedIpcSender(event)
      const query = typeof input?.query === 'string' ? input.query.slice(0, 100) : ''
      const installed = (await listSkills()).filter((skill) => skill.source === 'installed')
      return ok((await listSkillCatalog(query)).map((item) => ({ ...item, installed: installed.some((skill) =>
        skill.name === item.name || (item.name === 'superpowers' && skill.repository?.toLowerCase() === item.repository.toLowerCase())) })))
    } catch (error) {
      return err('SKILL_CATALOG_ERR', error instanceof Error ? error.message : '技能市场加载失败')
    }
  })

  ipcMain.handle(IPC.skills.install, async (event, input?: SkillInstallInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input.url !== 'string' || input.url.length > 2048) return err('INVALID_INPUT', 'GitHub 地址无效')
      await installSkillFromGitHub(getInstalledSkillRoot(), input.url)
      return ok(await listSkills(resolveWorkspace(input.workspaceId)))
    } catch (error) {
      return err('SKILL_INSTALL_ERR', error instanceof Error ? error.message : 'Skill 安装失败')
    }
  })

  ipcMain.handle(IPC.skills.importLocal, async (event, input?: SkillListInput) => {
    try {
      assertTrustedIpcSender(event)
      const selected = await dialog.showOpenDialog({ title: '选择 Skill 或 Skill Pack 目录', properties: ['openDirectory'] })
      if (selected.canceled || !selected.filePaths[0]) return ok(await listSkills(resolveWorkspace(input?.workspaceId)))
      await importSkillDirectory(getInstalledSkillRoot(), selected.filePaths[0])
      return ok(await listSkills(resolveWorkspace(input?.workspaceId)))
    } catch (error) {
      return err('SKILL_IMPORT_ERR', error instanceof Error ? error.message : 'Skill 导入失败')
    }
  })

  ipcMain.handle(IPC.skills.uninstall, async (event, input?: SkillUninstallInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input.id !== 'string') return err('INVALID_INPUT', 'Skill 标识无效')
      const workspace = resolveWorkspace(input.workspaceId)
      const current = await listSkills(workspace)
      const target = current.find((skill) => skill.id === input.id)
      if (!target || target.source !== 'installed') return err('NOT_FOUND', '只能卸载应用内安装的 Skill')
      await uninstallSkill(getInstalledSkillRoot(), target.name)
      return ok(await listSkills(workspace))
    } catch (error) {
      return err('SKILL_UNINSTALL_ERR', error instanceof Error ? error.message : 'Skill 卸载失败')
    }
  })

  ipcMain.handle(IPC.skills.setEnabled, async (event, input?: SkillToggleInput) => {
    try {
      assertTrustedIpcSender(event)
      if (!input || typeof input.enabled !== 'boolean' ||
          typeof input.id !== 'string' || !/^[a-z]+:[a-f0-9]{12}:[a-z0-9_-]{1,64}$/.test(input.id)) {
        return err('INVALID_INPUT', 'Skill 设置无效')
      }
      const workspace = resolveWorkspace(input.workspaceId)
      const current = await listSkills(workspace)
      if (!current.some((skill) => skill.id === input.id)) return err('NOT_FOUND', 'Skill 不存在')
      setSkillEnabled(input.id, input.enabled)
      return ok(await listSkills(workspace))
    } catch (error) {
      return err('SKILL_SET_ERR', error instanceof Error ? error.message : 'Skill 设置保存失败')
    }
  })
}

function resolveWorkspace(workspaceId?: string) {
  if (!workspaceId) return undefined
  const grant = getWorkspaceService().getGrant(workspaceId)
  if (!grant) throw new Error('项目工作区不存在或未授权')
  return grant
}
