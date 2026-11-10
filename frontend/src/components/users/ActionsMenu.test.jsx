import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ActionsMenu from './ActionsMenu.jsx'

describe('ActionsMenu', () => {
  afterEach(cleanup)

  it('dispatches the selected user action and restores trigger focus', () => {
    const onAction = vi.fn()
    const user = { id: 7, username: 'jordan', first_name: 'Jordan', last_name: 'Santos', role: 'student', is_active: true }
    render(<ActionsMenu user={user} onAction={onAction} />)

    const trigger = screen.getByRole('button', { name: 'Actions for Jordan Santos' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit User' }))

    expect(onAction).toHaveBeenCalledWith('edit', user)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toBe(document.activeElement)
  })

  it('shows password recovery only for student accounts', () => {
    const onAction = vi.fn()
    const { rerender } = render(<ActionsMenu user={{ id: 7, username: 'jordan', role: 'student' }} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for jordan' }))
    expect(screen.getByRole('menuitem', { name: 'Reset Password' })).toBeTruthy()

    rerender(<ActionsMenu user={{ id: 8, username: 'teacher', role: 'instructor' }} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for teacher' }))
    expect(screen.queryByRole('menuitem', { name: 'Reset Password' })).toBeNull()
  })

  it('disables deactivation and deletion for protected administrators', () => {
    render(<ActionsMenu user={{ id: 1, username: 'admin', role: 'admin', is_active: true }} protectedAccount onAction={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for admin' }))

    expect(screen.getByRole('menuitem', { name: 'Deactivate Account' }).disabled).toBe(true)
    expect(screen.getByRole('menuitem', { name: 'Delete Account' }).disabled).toBe(true)
  })
})