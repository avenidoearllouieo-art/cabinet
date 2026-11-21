import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import api from '../../services/api'
import NfcRegistration from './NfcRegistration.jsx'

vi.mock('../../services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

function renderRegistration() {
  return render(
    <MemoryRouter initialEntries={['/register?token=valid-enrollment-token']}>
      <Routes>
        <Route path="/register" element={<NfcRegistration />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NfcRegistration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.get.mockResolvedValue({ data: { valid: true, completion_expires_at: '2099-11-21T12:00:00Z' } })
    api.post.mockResolvedValue({ data: { success: true } })
  })

  afterEach(() => cleanup())

  it('completes a student registration without a PIN', async () => {
    api.post.mockResolvedValue({
      data: {
        success: true,
        registration_status: 'registered',
        role: 'student',
        name: 'Taylor Student',
        student_id: 'STU-001',
        nfc_registered: true,
      },
    })

    renderRegistration()
    fireEvent.change(await screen.findByLabelText('ID Number'), { target: { value: 'STU-001' } })
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'taylor@example.edu' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'taylor.student' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Student-Password-123!' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Student-Password-123!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete Registration' }))

    expect(await screen.findByRole('heading', { name: 'Registration Successful!' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to TapTrack Portal' }).getAttribute('href')).toBe('https://taptrack-web.onrender.com/')
    expect(screen.getByText('You can now return to the cabinet and tap your ID card again.')).toBeTruthy()
    expect(screen.getByText('NFC Card Status').parentElement.textContent).toContain('Registered')
    expect(api.post).toHaveBeenCalledWith('/cabinet/enrollment/register/', {
      token: 'valid-enrollment-token',
      id_number: 'STU-001',
      email: 'taylor@example.edu',
      username: 'taylor.student',
      password: 'Student-Password-123!',
      confirm_password: 'Student-Password-123!',
    })
  }, 15000)

  it('does not offer role selection or PIN fields', async () => {
    renderRegistration()
    await screen.findByRole('heading', { name: 'Complete Your Registration' })
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByLabelText(/Registration PIN/i)).toBeNull()
  })

  it('does not present a completed registration link as expired or reopen the form', async () => {
    api.get.mockResolvedValue({ data: { valid: false, status: 'completed' } })

    renderRegistration()

    expect(await screen.findByRole('heading', { name: 'Registration Already Completed' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Registration Expired' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Complete Registration' })).toBeNull()
  })

  it('shows generic backend validation errors', async () => {
    api.post.mockRejectedValue({
      response: { status: 400, data: { error: 'Registration could not be completed.' } },
    })

    renderRegistration()
    fireEvent.change(await screen.findByLabelText('ID Number'), { target: { value: 'INVALID-ID' } })
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'invalid@example.edu' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'invalid.user' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Unique-Password-983!' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Unique-Password-983!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete Registration' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Registration could not be completed.')
  }, 15000)
})