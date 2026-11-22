import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import ForgotPassword from './ForgotPassword.jsx'

vi.mock('../../services/api.js', () => ({
  default: {
    post: vi.fn(),
  },
}))

function renderForgotPassword() {
  return render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  )
}

async function submitRequest(user) {
  await user.type(screen.getByLabelText(/Student ID/), 'STU-1042')
  await user.type(screen.getByLabelText(/Email/), 'student@example.test')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    api.post.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('validates account details before starting a request', async () => {
    const user = userEvent.setup()
    renderForgotPassword()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('alert').textContent).toContain('Enter both your Student ID and email')
    expect(api.post).not.toHaveBeenCalled()
  })

  it('shows initiation errors without moving to cabinet verification', async () => {
    const user = userEvent.setup()
    api.post.mockRejectedValueOnce({ response: { status: 429 } })
    renderForgotPassword()

    await submitRequest(user)

    expect((await screen.findByRole('alert')).textContent).toMatch(/Too many reset attempts/i)
    expect(screen.queryByTestId('recovery-reference')).toBeNull()
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ response: { status: 500 } }, /temporarily unavailable/i],
    [new Error('Network unavailable'), /could not reach the password-reset service/i],
  ])('reports initiation service failures without advancing', async (failure, expectedMessage) => {
    const user = userEvent.setup()
    api.post.mockRejectedValueOnce(failure)
    renderForgotPassword()

    await submitRequest(user)

    expect((await screen.findByRole('alert')).textContent).toMatch(expectedMessage)
    expect(screen.queryByTestId('recovery-reference')).toBeNull()
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it('does not advance when initiation returns success without a valid request reference', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValueOnce({ data: { message: 'Request started.' } })
    renderForgotPassword()

    await submitRequest(user)

    expect((await screen.findByRole('alert')).textContent).toMatch(/returned an invalid response/i)
    expect(screen.queryByTestId('recovery-reference')).toBeNull()
  })

  it('shows cabinet name-selection instructions without exposing the internal reference', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    api.post
      .mockResolvedValueOnce({ data: { request_id: 'opaque-ref-7f4a', expires_at: '2026-10-24T15:00:00Z' } })
      .mockResolvedValueOnce({ data: { status: 'pending' } })
    renderForgotPassword()

    await submitRequest(user)

    expect(await screen.findByText(/Go to the TapTrack cabinet and select your name from the pending password-recovery requests/)).toBeTruthy()
    expect(await screen.findByText(/Waiting for the cabinet/)).toBeTruthy()
    expect(screen.getByText(/Request expires:/)).toBeTruthy()
    expect(screen.queryByTestId('recovery-reference')).toBeNull()
    expect(screen.queryByText('opaque-ref-7f4a')).toBeNull()
    expect(api.post).toHaveBeenNthCalledWith(1, '/auth/password-reset/request/', {
      student_id: 'STU-1042',
      email: 'student@example.test',
    })
    expect(api.post).toHaveBeenNthCalledWith(2, '/auth/password-reset/status/', { request_id: 'opaque-ref-7f4a' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('polls until verified, then confirms a new password with the authorization', async () => {
    const user = userEvent.setup()
    api.post
      .mockResolvedValueOnce({ data: { request_id: 'opaque-ref-verified' } })
      .mockResolvedValueOnce({ data: { status: 'pending' } })
      .mockResolvedValueOnce({ data: { status: 'verified', reset_authorization: 'one-time-auth-value' } })
      .mockResolvedValueOnce({ data: { detail: 'Password changed.' } })
    renderForgotPassword()

    await submitRequest(user)
    await screen.findByText(/Waiting for the cabinet/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check verification status' }).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Check verification status' }))

    expect(await screen.findByRole('heading', { name: 'Create a new password' })).toBeTruthy()
    await user.type(screen.getByLabelText(/New password/), 'New-Password-123!')
    await user.type(screen.getByLabelText(/Confirm password/), 'New-Password-123!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/auth/password-reset/confirm/', {
      request_id: 'opaque-ref-verified',
      reset_authorization: 'one-time-auth-value',
      new_password: 'New-Password-123!',
      confirm_password: 'New-Password-123!',
    }))
    expect(await screen.findByText('Password changed successfully! You can now log in with your new password.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go to Login' })).toBeTruthy()
  })

  it.each([
    ['expired', /reset request has expired/i],
    ['cancelled', /reset request was cancelled/i],
    ['rejected', /verification was rejected/i],
  ])('stops on terminal %s status without showing the password step', async (status, message) => {
    const user = userEvent.setup()
    api.post
      .mockResolvedValueOnce({ data: { request_id: `opaque-${status.toLowerCase()}` } })
      .mockResolvedValueOnce({ data: { status } })
    renderForgotPassword()

    await submitRequest(user)

    expect((await screen.findByRole('alert')).textContent).toMatch(message)
    expect(screen.queryByRole('heading', { name: 'Create a new password' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Check verification status' }).disabled).toBe(true)
  })

  it('does not advance when VERIFIED lacks reset authorization', async () => {
    const user = userEvent.setup()
    api.post
      .mockResolvedValueOnce({ data: { request_id: 'opaque-no-auth' } })
      .mockResolvedValueOnce({ data: { status: 'verified' } })
    renderForgotPassword()

    await submitRequest(user)

    expect((await screen.findByRole('alert')).textContent).toMatch(/without reset authorization/i)
    expect(screen.queryByRole('heading', { name: 'Create a new password' })).toBeNull()
  })

  it('validates password confirmation before submitting the reset', async () => {
    const user = userEvent.setup()
    api.post
      .mockResolvedValueOnce({ data: { request_id: 'opaque-password-validation' } })
      .mockResolvedValueOnce({ data: { status: 'verified', reset_authorization: 'one-time-auth-value' } })
    renderForgotPassword()

    await submitRequest(user)
    expect(await screen.findByRole('heading', { name: 'Create a new password' })).toBeTruthy()
    await user.type(screen.getByLabelText(/New password/), 'New-Password-123!')
    await user.type(screen.getByLabelText(/Confirm password/), 'different-password')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(screen.getByText('The passwords do not match.')).toBeTruthy()
    expect(api.post).toHaveBeenCalledTimes(2)
  })

  it('shows the server password-validation reason and retains authorization for a corrected retry', async () => {
    const user = userEvent.setup()
    api.post
      .mockResolvedValueOnce({ data: { request_id: 'opaque-validator-retry' } })
      .mockResolvedValueOnce({ data: { status: 'verified', reset_authorization: 'retryable-auth' } })
      .mockRejectedValueOnce({
        response: {
          status: 400,
          data: { new_password: ['The password is too similar to the username.'] },
        },
      })
      .mockResolvedValueOnce({ data: { message: 'Password reset completed successfully.' } })
    renderForgotPassword()

    await submitRequest(user)
    expect(await screen.findByRole('heading', { name: 'Create a new password' })).toBeTruthy()
    await user.type(screen.getByLabelText(/New password/), 'New-Password-123!')
    await user.type(screen.getByLabelText(/Confirm password/), 'New-Password-123!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('The password is too similar to your username. Please choose a different password.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Create a new password' })).toBeTruthy()
    expect(screen.getByText('Reset authorization verified')).toBeTruthy()
    expect(screen.getByLabelText(/New password/).value).toBe('New-Password-123!')
    expect(screen.getByLabelText(/Confirm password/).value).toBe('New-Password-123!')

    await user.clear(screen.getByLabelText(/New password/))
    await user.type(screen.getByLabelText(/New password/), 'Corrected-Password-456!')
    await user.clear(screen.getByLabelText(/Confirm password/))
    await user.type(screen.getByLabelText(/Confirm password/), 'Corrected-Password-456!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Password changed successfully! You can now log in with your new password.')).toBeTruthy()
    expect(api.post).toHaveBeenLastCalledWith('/auth/password-reset/confirm/', {
      request_id: 'opaque-validator-retry',
      reset_authorization: 'retryable-auth',
      new_password: 'Corrected-Password-456!',
      confirm_password: 'Corrected-Password-456!',
    })
    expect(document.body.textContent).not.toContain('retryable-auth')
  })

  it.each([
    ['minimum length', 'This password is too short. It must contain at least 8 characters.', 'Use at least 8 characters.'],
    ['commonly used', 'This password is too common.', 'This password is too common. Choose a more unique password.'],
    ['numeric only', 'This password is entirely numeric.', 'Your password cannot contain only numbers.'],
    ['previous password reuse', 'Your new password must be different from your current password.', "Choose a password you haven't used for this account."],
    ['unexpected safe validation', 'A server-side validation message.', 'A server-side validation message.'],
    ['unsafe validation details', '<script>private backend detail</script>', 'Choose a different password that meets the account security requirements.'],
  ])('shows the Django %s validation message inline', async (_rule, message, expectedMessage) => {
    const user = userEvent.setup()
    api.post
      .mockResolvedValueOnce({ data: { request_id: 'opaque-validator-message' } })
      .mockResolvedValueOnce({ data: { status: 'verified', reset_authorization: 'safe-auth' } })
      .mockRejectedValueOnce({ response: { status: 400, data: { new_password: [message] } } })
    renderForgotPassword()

    await submitRequest(user)
    expect(await screen.findByRole('heading', { name: 'Create a new password' })).toBeTruthy()
    expect(screen.queryByLabelText(/Current password/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Show new password' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show confirm password' })).toBeTruthy()
    await user.type(screen.getByLabelText(/New password/), 'New-Password-123!')
    await user.type(screen.getByLabelText(/Confirm password/), 'New-Password-123!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText(expectedMessage)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Create a new password' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('safe-auth')
  })

  it('handles invalid and expired reset authorization without exposing server details', async () => {
    for (const [status, message] of [
      [400, /authorization could not be verified/i],
      [410, /reset request or token has expired/i],
    ]) {
      const user = userEvent.setup()
      api.post
        .mockResolvedValueOnce({ data: { request_id: `opaque-auth-${status}` } })
        .mockResolvedValueOnce({ data: { status: 'verified', reset_authorization: 'temporary-auth' } })
        .mockRejectedValueOnce({
          response: { status, data: { error: 'private database diagnostic should not be shown' } },
        })
      const { unmount } = renderForgotPassword()

      await submitRequest(user)
      expect(await screen.findByRole('heading', { name: 'Create a new password' })).toBeTruthy()
      await user.type(screen.getByLabelText(/New password/), 'New-Password-123!')
      await user.type(screen.getByLabelText(/Confirm password/), 'New-Password-123!')
      await user.click(screen.getByRole('button', { name: 'Change password' }))

      expect((await screen.findByRole('alert')).textContent).toMatch(message)
      expect(document.body.textContent).not.toContain('private database diagnostic')
      expect(document.body.textContent).not.toContain('temporary-auth')
      unmount()
      api.post.mockReset()
    }
  })

  it('shows a retry message when the password-reset confirmation cannot reach the server', async () => {
    const user = userEvent.setup()
    api.post
      .mockResolvedValueOnce({ data: { request_id: 'opaque-network-reset' } })
      .mockResolvedValueOnce({ data: { status: 'verified', reset_authorization: 'network-auth' } })
      .mockRejectedValueOnce(new Error('Network unavailable'))
    renderForgotPassword()

    await submitRequest(user)
    expect(await screen.findByRole('heading', { name: 'Create a new password' })).toBeTruthy()
    await user.type(screen.getByLabelText(/New password/), 'New-Password-123!')
    await user.type(screen.getByLabelText(/Confirm password/), 'New-Password-123!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not reach the password-reset service/i)
    expect(screen.getByRole('heading', { name: 'Create a new password' })).toBeTruthy()
  })

  it('keeps polling available after a network error', async () => {
    const user = userEvent.setup()
    api.post
      .mockResolvedValueOnce({ data: { request_id: 'opaque-network-error' } })
      .mockRejectedValueOnce(new Error('Network unavailable'))
    renderForgotPassword()

    await submitRequest(user)

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not check cabinet verification status/i)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check verification status' }).disabled).toBe(false))
  })

  it('prevents duplicate request submissions while initiation is loading', async () => {
    const user = userEvent.setup()
    let resolveRequest
    api.post.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve }))
    renderForgotPassword()
    await user.type(screen.getByLabelText(/Student ID/), 'STU-1042')
    await user.type(screen.getByLabelText(/Email/), 'student@example.test')

    const submitButton = screen.getByRole('button', { name: 'Continue' })
    fireEvent.click(submitButton)
    fireEvent.click(submitButton)

    expect(api.post).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Starting request/ }).disabled).toBe(true)
    resolveRequest({ data: { request_id: 'opaque-loading' } })
    expect(await screen.findByText(/Go to the TapTrack cabinet and select your name/)).toBeTruthy()
  })
})
