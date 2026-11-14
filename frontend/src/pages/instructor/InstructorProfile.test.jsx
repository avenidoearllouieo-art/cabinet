import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import api from '../../services/api.js'
import InstructorProfile from './InstructorProfile.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), patch: vi.fn() } }))

const profile = {
  id: 8,
  role: 'instructor',
  first_name: 'Rae',
  last_name: 'Santos',
  instructor_id: 'EMP-8',
  username: 'rae.teacher',
  email: 'rae@example.edu',
  contact_number: '555-1000',
  nfc_uid: 'INSTRUCTOR-UID-MUST-NOT-DISPLAY',
  assigned_sections: [{
    section_id: 3,
    section_name: 'Section A',
    program: 'BSCS',
    year_level: '2nd Year',
    academic_year: '2026-2027',
  }],
}

describe('InstructorProfile', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('uses the Profile labels, preserves section details, hides UID, and retains Security navigation', async () => {
    api.get.mockResolvedValue({ data: profile })
    render(
      <MemoryRouter initialEntries={['/instructor/profile']}>
        <Routes>
          <Route path="/instructor/profile" element={<InstructorProfile />} />
          <Route path="/instructor/profile/change-password" element={<p>Change Password Page</p>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByText('Manage your account and contact information.')).toBeTruthy()
    expect(screen.getByText('Year level')).toBeTruthy()
    expect(screen.getByText('Academic year')).toBeTruthy()
    expect(screen.getByText('2026-2027')).toBeTruthy()
    expect(screen.queryByText('INSTRUCTOR-UID-MUST-NOT-DISPLAY')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    expect(screen.getByLabelText(/Employee ID/)).toBeTruthy()
    expect(screen.getByLabelText(/Username/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }))
    expect(await screen.findByText('Change Password Page')).toBeTruthy()
  })
})