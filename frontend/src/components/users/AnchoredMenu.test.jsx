import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import AnchoredMenu from './AnchoredMenu.jsx'

function MenuHarness() {
  const [open, setOpen] = useState(false)
  return (
    <AnchoredMenu
      open={open}
      onOpenChange={setOpen}
      ariaLabel="User actions"
      renderTrigger={(props) => <button type="button" {...props}>Actions</button>}
    >
      <button type="button" role="menuitem">Edit User</button>
    </AnchoredMenu>
  )
}

describe('AnchoredMenu', () => {
  afterEach(cleanup)

  it('closes on Escape and restores focus to its trigger', () => {
    render(<MenuHarness />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    fireEvent.click(trigger)

    expect(screen.getByRole('menu', { name: 'User actions' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Edit User' })).toBe(document.activeElement)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toBe(document.activeElement)
  })

  it('closes when the user clicks outside', () => {
    render(<MenuHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('clamps to the viewport and opens upward when the trigger is near the bottom edge', async () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBounds() {
      if (this.getAttribute('aria-haspopup') === 'menu') return { left: 286, right: 310, top: 448, bottom: 480, width: 24, height: 32 }
      if (this.getAttribute('role') === 'menu') return { left: 0, right: 240, top: 0, bottom: 300, width: 240, height: 300 }
      return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }
    })
    render(<MenuHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))

    const menu = await screen.findByRole('menu', { name: 'User actions' })
    await waitFor(() => {
      expect(menu.style.left).toBe('70px')
      expect(menu.style.top).toBe('140px')
    })
  })
})