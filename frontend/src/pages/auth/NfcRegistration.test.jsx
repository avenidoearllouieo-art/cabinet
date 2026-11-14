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
    api.get.mockResolvedValue({ data: { valid: true, expires_at: '2026-11-12T12:00:00Z' } })
  })

  afterEach(() => cleanup())

  it('registers an existing student directly and displays only Django success details', async () => {
    api.post.mockResolvedValue({
      data: {
        success: true,
        role: 'student',
        name: 'Taylor Student',
        student_id: 'STU-001',
        nfc_registered: true,
      },
    })

    renderRegistration()
    await screen.findByRole('radio', { name: 'student' })
    expect(screen.queryByText('Taylor Student')).toBeNull()
    expect(screen.queryByText(/email verification|verification code|find my account/i)).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'student' }))
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: 'STU-001' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'taylor.student' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Student-Password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Student-Password-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register NFC Card' }))

    expect(await screen.findByRole('heading', { name: 'NFC Registration Successful' })).toBeTruthy()
    expect(screen.getByText('Taylor Student')).toBeTruthy()
    expect(screen.getByText('student')).toBeTruthy()
    expect(screen.getByText('Registered')).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith('/cabinet/enrollment/validate/', { params: { token: 'valid-enrollment-token' } })
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.post).toHaveBeenCalledWith('/cabinet/enrollment/register/', {
      token: 'valid-enrollment-token',
      role: 'student',
      student_id: 'STU-001',
      username: 'taylor.student',
      password: 'Student-Password-123',
      confirm_password: 'Student-Password-123',
    })
  }, 15000)

  it('uses the instructor ID and displays the successful instructor result', async () => {
    api.post.mockResolvedValue({
      data: {
        success: true,
        role: 'instructor',
        name: 'Rae Instructor',
        instructor_id: 'INS-009',
        nfc_registered: true,
      },
    })

    renderRegistration()
    await screen.findByRole('radio', { name: 'instructor' })
    fireEvent.click(screen.getByRole('radio', { name: 'instructor' }))
    fireEvent.change(screen.getByLabelText('Instructor ID'), { target: { value: 'INS-009' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'rae.instructor' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Instructor-Password-987' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Instructor-Password-987' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register NFC Card' }))

    expect(await screen.findByRole('heading', { name: 'NFC Registration Successful' })).toBeTruthy()
    expect(screen.getByText('Rae Instructor')).toBeTruthy()
    expect(screen.getByText('instructor')).toBeTruthy()
    expect(api.post).toHaveBeenCalledWith('/cabinet/enrollment/register/', {
      token: 'valid-enrollment-token',
      role: 'instructor',
      instructor_id: 'INS-009',
      username: 'rae.instructor',
      password: 'Instructor-Password-987',
      confirm_password: 'Instructor-Password-987',
    })
  }, 15000)

  it('shows backend validation errors without exposing roster information', async () => {
    api.post.mockRejectedValue({
      response: { status: 404, data: { error: 'No account matches the selected role and ID.' } },
    })

    renderRegistration()
    await screen.findByRole('radio', { name: 'student' })
    fireEvent.click(screen.getByRole('radio', { name: 'student' }))
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: 'INVALID-ID' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'invalid.user' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Unique-Password-983!' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Unique-Password-983!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register NFC Card' }))

    expect((await screen.findByRole('alert')).textContent).toContain('No account matches the selected role and ID.')
    expect(screen.queryByText('Taylor Student')).toBeNull()
  }, 15000)
})