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

  it('allows a long passphrase without a symbol and delegates policy validation to Django', async () => {
    api.post.mockRejectedValue({
      response: { status: 400, data: { new_password: ['A server-side validation message.'] } },
    })
    render(<MemoryRouter><ChangePasswordForm role="instructor" /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: 'Current-Password-123!' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'bright morning beside quiet rivers' } })
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: 'bright morning beside quiet rivers' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/users/change_password/', {
      current_password: 'Current-Password-123!',
      new_password: 'bright morning beside quiet rivers',
      confirm_password: 'bright morning beside quiet rivers',
    }))
    expect(screen.queryByText(/Use upper- and lowercase letters/i)).toBeNull()
  })

  it('shows a friendly inline Django password-validation message', async () => {
    api.post.mockRejectedValue({
      response: { status: 400, data: { new_password: ['This password is too common.'] } },
    })
    render(<MemoryRouter><ChangePasswordForm role="student" /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: 'Current-Password-123!' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'bright morning beside quiet rivers' } })
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: 'bright morning beside quiet rivers' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('This password is too common. Choose a more unique password.')).toBeTruthy()
  })
})