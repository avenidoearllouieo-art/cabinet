import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import StudentProfile from './StudentProfile.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('StudentProfile', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('keeps academic year details and instructor information without a Contact Instructor action', async () => {
    api.get.mockResolvedValue({ data: {
      username: 'student',
      role: 'student',
      student_id: 'STU-001',
      first_name: 'Student',
      last_name: 'One',
      email: 'student@example.test',
      section_name: 'Section A',
      section_program: 'BSCS',
      section_year_level: '3rd Year',
      section_academic_year: '2025-2026',
      is_active: true,
      nfc_uid: 'STUDENT-UID-PRIVATE',
      section_instructors: [{
        id: 2,
        role: 'instructor',
        first_name: 'Rae',
        last_name: 'Santos',
        email: 'rae@example.test',
        contact_number: '555-0101',
      }],
    } })

    render(<MemoryRouter><StudentProfile /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByText('Manage your account and contact information.')).toBeTruthy()
    expect(await screen.findByText('Academic Information')).toBeTruthy()
    expect(screen.getByText('Year Level')).toBeTruthy()
    expect(screen.getByText('Academic Year')).toBeTruthy()
    expect(screen.getByText('2025-2026')).toBeTruthy()
    expect(screen.getByText('Rae Santos')).toBeTruthy()
    expect(screen.getByText('rae@example.test')).toBeTruthy()
    expect(screen.getByText('555-0101')).toBeTruthy()
    expect(screen.getByText('Assigned Section')).toBeTruthy()
    expect(screen.getByText('Account Status')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.queryByText('STUDENT-UID-PRIVATE')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Contact Instructor' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Contact Instructor' })).toBeNull()
  })
})