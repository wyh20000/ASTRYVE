import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest, TaskSnapshot } from '../../../shared/agent'
const mocks = vi.hoisted(() => ({ windows: vi.fn(), show: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: mocks.windows }, dialog: { showMessageBox: mocks.show } }))
import { createApprovalDialog } from './approvalDialog'

describe('native approval dialog ownership', () => {
  const owner = { webContents: { id: 5 }, isDestroyed: () => false }
  const request = { taskId: 'task', workspaceId: 'workspace', operation: 'fs.patch',
    environment: 'local', risk: 'high', summary: '修改文件', normalizedTarget: 'src/a.ts', scopeOptions: ['once'] } as ApprovalRequest
  const task = { id: 'task', workspaceId: 'workspace', ownerWebContentsId: 5 } as TaskSnapshot
  beforeEach(() => { vi.resetAllMocks(); mocks.windows.mockReturnValue([owner]) })
  it('uses the owning window and defaults to rejection', async () => {
    mocks.show.mockResolvedValue({ response: 1 })
    expect(await createApprovalDialog(() => task)(request, new AbortController().signal)).toBe('once')
    expect(mocks.show).toHaveBeenCalledWith(owner, expect.objectContaining({ defaultId: 0, cancelId: 0, buttons: ['拒绝', '仅批准本次'] }))
  })
  it('does not show a dialog for another window or missing task', async () => {
    mocks.windows.mockReturnValue([{ ...owner, webContents: { id: 8 } }])
    expect(await createApprovalDialog(() => task)(request, new AbortController().signal)).toBeUndefined()
    expect(mocks.show).not.toHaveBeenCalled()
  })
  it('ignores forged response indexes and cancelled dialog results', async () => {
    mocks.show.mockResolvedValue({ response: 2 })
    expect(await createApprovalDialog(() => task)(request, new AbortController().signal)).toBeUndefined()
    const controller = new AbortController()
    mocks.show.mockImplementation(async () => { controller.abort(); return { response: 1 } })
    expect(await createApprovalDialog(() => task)(request, controller.signal)).toBeUndefined()
  })
})
