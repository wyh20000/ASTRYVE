import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { assertTrustedIpcSender, assertTrustedRenderer } from './validation'
import { err, ok } from './result'
import { cancelLogin, currentAuthStatus, logout, startAccountLink, startLogin } from '../services/auth/authSession'

export function registerAuthIpc(): void {
  ipcMain.handle(IPC.auth.status, (event) => {
    try { assertTrustedRenderer(event); return ok(currentAuthStatus()) }
    catch { return err('AUTH_ORIGIN', '登录请求来源无效') }
  })
  ipcMain.handle(IPC.auth.start, async (event) => {
    try { assertTrustedRenderer(event); return ok(await startLogin()) }
    catch { return err('AUTH_START', '无法启动登录，请稍后重试') }
  })
  ipcMain.handle(IPC.auth.cancel, (event) => {
    try { assertTrustedRenderer(event); return ok(cancelLogin()) }
    catch { return err('AUTH_ORIGIN', '登录请求来源无效') }
  })
  ipcMain.handle(IPC.auth.logout, async (event) => {
    try { assertTrustedRenderer(event); return ok(await logout()) }
    catch { return err('AUTH_LOGOUT', '退出登录失败') }
  })
  ipcMain.handle(IPC.auth.link, async (event) => {
    try { assertTrustedIpcSender(event); return ok(await startAccountLink()) }
    catch { return err('AUTH_LINK', '无法启动账号绑定，请检查登录状态和认证服务') }
  })
}
