import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import api from '../../services/api.js'
import InstructorProfile from './InstructorProfile.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }))

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
    expect(screen.getByText('2026–2027')).toBeTruthy()
    expect(screen.queryByText('Program')).toBeNull()
    expect(screen.queryByText('INSTRUCTOR-UID-MUST-NOT-DISPLAY')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    expect(screen.getByLabelText(/Employee ID/)).toBeTruthy()
    expect(screen.getByLabelText(/Username/)).toBeTruthy()
    expect(screen.getByLabelText(/Username/).readOnly).toBe(true)
    expect(screen.getByText(/Login credentials are managed/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }))
    expect(await screen.findByText('Change Password Page')).toBeTruthy()
  })

  it('uploads immediately and preserves Instructor edits through Continue, Back, and final save', async () => {
    api.get.mockResolvedValue({ data: profile })
    api.post.mockResolvedValue({ data: { ...profile, profile_image_url: '/media/instructor.png' } })
    api.patch.mockResolvedValue({ data: { ...profile, contact_number: '555-2000', profile_image_url: '/media/instructor.png' } })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:instructor-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    render(<MemoryRouter><InstructorProfile /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Profile' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Contact Number/ }), { target: { value: '555-2000' } })
    fireEvent.change(screen.getByLabelText(/Choose Photo/), {
      target: { files: [new File(['image'], 'instructor.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(screen.getAllByRole('img', { name: 'Rae Santos profile picture' }).length).toBeGreaterThan(0)
    const editDialog = screen.getByRole('dialog', { name: 'Edit Profile' })
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Review profile changes' })).toBeTruthy()
    expect(screen.getByText('555-2000')).toBeTruthy()
    expect(api.patch).not.toHaveBeenCalled()

    fireEvent.click(within(editDialog).getByRole('button', { name: 'Back' }))
    expect(within(editDialog).getByRole('textbox', { name: /Contact Number/ }).value).toBe('555-2000')
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Continue' }))
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
    expect(api.patch).toHaveBeenCalledWith('/users/update_profile/', {
      first_name: 'Rae',
      last_name: 'Santos',
      instructor_id: 'EMP-8',
      email: 'rae@example.edu',
      contact_number: '555-2000',
    })
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(screen.getByText('555-2000')).toBeTruthy()
  })

  it('preserves the instructor draft and shows a safe field error after a rejected save', async () => {
    api.get.mockResolvedValue({ data: profile })
    api.patch.mockRejectedValue({ response: { status: 400, data: { email: ['Enter a valid email address.'] } } })
    render(<MemoryRouter><InstructorProfile /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Profile' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Contact Number/ }), { target: { value: '555-2000' } })
    const editDialog = screen.getByRole('dialog', { name: 'Edit Profile' })
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Continue' }))
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy()
    expect(within(editDialog).getByRole('textbox', { name: /Contact Number/ }).value).toBe('555-2000')
    expect(within(editDialog).getByRole('textbox', { name: /Username/ }).value).toBe('rae.teacher')
    expect(api.patch).toHaveBeenCalledTimes(1)
    expect(api.patch.mock.calls[0][1]).not.toHaveProperty('username')
  })

  it('shows required Employee ID validation and stays on profile details', async () => {
    api.get.mockResolvedValue({ data: profile })
    render(<MemoryRouter><InstructorProfile /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Profile' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Employee ID/ }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Enter your Employee ID.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Review profile changes' })).toBeNull()
  })
})