/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import App from './App'

it('keeps the conversation UI unmounted when the main process denies authentication', async () => {
  const listSessions = vi.fn()
  Object.assign(window.agent, {
    auth: {
      status: async () => ({ ok: true, data: { mode: 'remote', state: 'signedOut' } }),
      start: async () => ({ ok: true, data: { mode: 'remote', state: 'waiting' } }),
      cancel: async () => ({ ok: true, data: { mode: 'remote', state: 'signedOut' } })
    },
    sessions: { list: listSessions }
  })
  render(<App />)
  expect(await screen.findByRole('region', { name: '登录 ASTRYVE' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /开始登录/ })).toBeInTheDocument()
  expect(listSessions).not.toHaveBeenCalled()
})
