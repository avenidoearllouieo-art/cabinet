import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import StudentProfile from './StudentProfile.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }))

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
    expect(screen.getByText('2025–2026')).toBeTruthy()
    expect(screen.getByText('Rae Santos')).toBeTruthy()
    expect(screen.getByText('rae@example.test')).toBeTruthy()
    expect(screen.getByText('555-0101')).toBeTruthy()
    expect(screen.getByText('Assigned Section')).toBeTruthy()
    expect(screen.getByText('Account Status')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.queryByText('STUDENT-UID-PRIVATE')).toBeNull()
    expect(screen.queryByText('Program')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Contact Instructor' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Contact Instructor' })).toBeNull()
  })

  it('uploads the picture immediately and keeps profile changes navigable and saveable', async () => {
    const currentProfile = {
      username: 'student', role: 'student', student_id: 'STU-001', first_name: 'Student', last_name: 'One',
      email: 'student@example.test', contact_number: '555-0001', is_active: true,
    }
    api.get.mockResolvedValue({ data: currentProfile })
    api.post.mockResolvedValue({ data: { ...currentProfile, profile_image_url: '/media/student.png' } })
    api.patch.mockResolvedValue({ data: { ...currentProfile, email: 'updated@example.test', contact_number: '555-0002', profile_image_url: '/media/student.png' } })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:student-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    render(<MemoryRouter><StudentProfile /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Profile' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Email Address/ }), { target: { value: 'updated@example.test' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Contact Number/ }), { target: { value: '555-0002' } })
    fireEvent.change(screen.getByLabelText(/Choose Photo/), {
      target: { files: [new File(['image'], 'student.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(screen.getAllByRole('img', { name: 'Student One profile picture' }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Review profile changes' })).toBeTruthy()
    expect(screen.getByText('updated@example.test')).toBeTruthy()
    expect(screen.getByText('555-0002')).toBeTruthy()

    const editDialog = screen.getByRole('dialog', { name: 'Edit Profile' })
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Back' }))
    expect(within(editDialog).getByRole('textbox', { name: /Email Address/ }).value).toBe('updated@example.test')
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Continue' }))
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
    expect(api.patch).toHaveBeenCalledWith('/users/update_profile/', {
      email: 'updated@example.test',
      contact_number: '555-0002',
    })
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it('shows required email validation and does not advance until corrected', async () => {
    api.get.mockResolvedValue({ data: { username: 'student', role: 'student', email: 'student@example.test' } })
    render(<MemoryRouter><StudentProfile /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Profile' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Email Address/ }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Enter your email address.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Review profile changes' })).toBeNull()
  })

  it('does not silently discard a selected picture when Save is clicked without Upload', async () => {
    api.get.mockResolvedValue({ data: {
      username: 'student', role: 'student', first_name: 'Student', last_name: 'One',
      email: 'student@example.test', contact_number: '',
    } })
    render(<MemoryRouter><StudentProfile /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Profile' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unuploaded-student')
    fireEvent.change(screen.getByLabelText(/Choose Photo/), {
      target: { files: [new File(['image'], 'student.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close Preview' }))
    const editDialog = screen.getByRole('dialog', { name: 'Edit Profile' })
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Continue' }))
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText('Upload or remove the selected profile picture before saving.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Edit Profile' })).toBeTruthy()
    expect(api.post).not.toHaveBeenCalled()
    expect(api.patch).not.toHaveBeenCalled()
  })
})