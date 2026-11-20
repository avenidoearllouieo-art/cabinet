import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import ChangePasswordForm from './ChangePasswordForm.jsx'

vi.mock('../../services/api.js', () => ({ default: { post: vi.fn() } }))

describe('ChangePasswordForm', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('immediately explains that the new password must differ from the current password', () => {
    render(<MemoryRouter><ChangePasswordForm role="student" /></MemoryRouter>)
    const currentPassword = screen.getByLabelText(/^Current password/)
    const newPassword = screen.getByLabelText(/^New password/)

    fireEvent.change(currentPassword, { target: { value: 'Current-Password-123!' } })
    fireEvent.change(newPassword, { target: { value: 'Current-Password-123!' } })

    expect(screen.getByText('Your new password must be different from your current password.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: 'Current-Password-123!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(api.post).not.toHaveBeenCalled()
  })
})