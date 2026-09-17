/** @vitest-environment jsdom */
import { useRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useDismissibleLayer } from './useDismissibleLayer'

function Example(): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismissibleLayer(root, open, () => setOpen(false))

  return <>
    <div ref={root}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>打开</button>
      {open && <div role="menu"><button type="button">内部操作</button></div>}
    </div>
    <button type="button">外部区域</button>
  </>
}

describe('useDismissibleLayer', () => {
  it('点击浮层内部保持打开，点击外部关闭', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: '打开' }))
    await userEvent.click(screen.getByRole('button', { name: '内部操作' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '外部区域' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Escape 关闭并把焦点还给触发器', async () => {
    render(<Example />)
    const trigger = screen.getByRole('button', { name: '打开' })
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
