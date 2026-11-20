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

  it('completes a student registration through the private PIN step', async () => {
    api.post.mockResolvedValue({
      data: { success: true, role: 'student', name: 'Taylor Student', student_id: 'STU-001', nfc_registered: true },
    })

    renderRegistration()
    fireEvent.click(await screen.findByRole('radio', { name: 'Student ID' }))
    fireEvent.change(screen.getByLabelText('Student ID Number'), { target: { value: 'STU-001' } })
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'taylor@example.edu' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'taylor.student' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Student-Password-123!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Private PIN' }))

    fireEvent.change(await screen.findByLabelText('Registration PIN'), { target: { value: '1234567890' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete Registration' }))

    expect(await screen.findByRole('heading', { name: 'Registration Successful' })).toBeTruthy()
    expect(api.post).toHaveBeenCalledWith('/cabinet/enrollment/register/', {
      token: 'valid-enrollment-token',
      id_type: 'student',
      id_number: 'STU-001',
      email: 'taylor@example.edu',
      username: 'taylor.student',
      password: 'Student-Password-123!',
      registration_pin: '1234567890',
    })
  }, 15000)

  it('offers Instructor and Administrator ID choices', async () => {
    renderRegistration()
    fireEvent.click(await screen.findByRole('radio', { name: 'Instructor ID' }))
    expect(screen.getByLabelText('Instructor ID Number')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Administrator ID' }))
    expect(screen.getByLabelText('Administrator ID Number')).toBeTruthy()
  })

  it('shows generic backend validation errors', async () => {
    api.post.mockRejectedValue({
      response: { status: 400, data: { error: 'Registration could not be completed.' } },
    })

    renderRegistration()
    fireEvent.click(await screen.findByRole('radio', { name: 'Student ID' }))
    fireEvent.change(screen.getByLabelText('Student ID Number'), { target: { value: 'INVALID-ID' } })
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'invalid@example.edu' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'invalid.user' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Unique-Password-983!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Private PIN' }))
    fireEvent.change(await screen.findByLabelText('Registration PIN'), { target: { value: '0000000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete Registration' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Registration could not be completed.')
  }, 15000)
})