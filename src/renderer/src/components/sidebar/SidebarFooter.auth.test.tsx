/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import SidebarFooter from './SidebarFooter'

it('hides remote account actions in local mode', async () => {
  Object.assign(window.agent, {
    auth: {
      status: vi.fn(async () => ({ ok: true, data: {
        mode: 'local', state: 'authenticated', userId: '00000000-0000-4000-8000-000000000001'
      }})),
      logout: vi.fn(),
      link: vi.fn()
    }
  })
  render(<SidebarFooter />)
  expect(await screen.findByText('本地工作区')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: '绑定手机号 / QQ / 微信' })).not.toBeInTheDocument()
})
