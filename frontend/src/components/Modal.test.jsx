import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import Modal from './Modal.jsx'

function ModalHarness({ onClose = vi.fn() }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      <Modal
        isOpen={open}
        onClose={() => { onClose(); setOpen(false) }}
        title="User action"
        footer={<button type="button">Confirm</button>}
      >
        <button type="button">First field</button>
      </Modal>
    </>
  )
}

describe('Modal keyboard focus', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('traps Tab and restores focus after Escape closes the dialog', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 10, height: 10 }])
    const onClose = vi.fn()
    render(<ModalHarness onClose={onClose} />)
    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    trigger.focus()
    fireEvent.click(trigger)

    const close = await screen.findByRole('button', { name: 'Close dialog' })
    await waitFor(() => expect(close).toBe(document.activeElement))
    const last = screen.getByRole('button', { name: 'Confirm' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(close).toBe(document.activeElement)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(trigger).toBe(document.activeElement))
  })

  it('applies the requested maximum width', () => {
    render(<Modal isOpen title="Compact dialog" onClose={() => {}} maxWidth="520px">Details</Modal>)
    expect(screen.getByRole('dialog', { name: 'Compact dialog' }).style.maxWidth).toBe('520px')
  })

  it('closes only the topmost dialog on Escape', async () => {
    function NestedDialogs() {
      const [outerOpen, setOuterOpen] = useState(true)
      const [innerOpen, setInnerOpen] = useState(true)
      return (
        <Modal isOpen={outerOpen} onClose={() => setOuterOpen(false)} title="Outer dialog">
          <Modal isOpen={innerOpen} onClose={() => setInnerOpen(false)} title="Inner dialog">Nested content</Modal>
        </Modal>
      )
    }

    render(<NestedDialogs />)
    expect(screen.getByRole('dialog', { name: 'Outer dialog' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Inner dialog' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Inner dialog' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Outer dialog' })).toBeTruthy()
  })
})