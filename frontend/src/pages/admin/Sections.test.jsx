import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api from '../../services/api.js'
import Sections from './Sections.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), patch: vi.fn() } }))

const section = {
  id: 4,
  section_name: 'Section A',
  subject_code: 'CS-101',
  program: 'BSCS',
  year_level: '2nd Year',
  status: 'Active',
  student_count: 12,
  activity_count: 3,
  instructor: null,
  instructor_name: null,
}
const instructor = { id: 12, role: 'instructor', first_name: 'Rae', last_name: 'Santos', instructor_id: 'INS-12', email: 'rae@example.test', is_active: true }

describe('Admin Sections', () => {
  beforeEach(() => {
    api.get.mockImplementation((path, { params } = {}) => {
      if (path === '/sections/') return Promise.resolve({ data: [section] })
      if (path === '/users/' && params?.role === 'student') return Promise.resolve({ data: [{ id: 21, first_name: 'Mika', last_name: 'Reyes', student_id: 'ST-21', section_year_level: '2nd Year', is_active: true, nfc_uid: 'SHOULD_NOT_DISPLAY' }] })
      if (path === '/users/') return Promise.resolve({ data: { count: 1, next: null, results: [instructor] } })
      throw new Error(`Unexpected GET ${path}`)
    })
    api.patch.mockResolvedValue({ data: [{ ...section, instructor: instructor.id, instructor_name: 'Rae Santos' }] })
  })

  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('opens the details drawer above the page and restores background scroll on close', async () => {
    const user = userEvent.setup()
    render(<Sections />)
    await user.click((await screen.findAllByRole('button', { name: 'Open actions for Section A' }))[0])
    await user.click((await screen.findAllByRole('menuitem', { name: 'View Details' }))[0])

    const drawer = await screen.findByRole('dialog', { name: 'Section A' })
    expect(within(drawer).getByText('Section Details')).toBeTruthy()
    expect(drawer.querySelector('.overflow-y-auto')).toBeTruthy()
    expect(document.body.style.overflow).toBe('hidden')
    await user.click(within(drawer).getByRole('button', { name: 'Close section details' }))
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'))
  })

  it('opens assignment, loads registered instructors, and refreshes the assigned section', async () => {
    const user = userEvent.setup()
    render(<Sections />)
    await user.click((await screen.findAllByRole('checkbox', { name: 'Select Section A' }))[0])
    await user.click(screen.getByRole('button', { name: 'Assign Instructor (1)' }))

    expect(await screen.findByText('CS-101 · Section A')).toBeTruthy()
    expect(await screen.findByRole('option', { name: /Rae Santos.*INS-12.*rae@example.test/ })).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Instructor' }), '12')
    await user.click(screen.getByRole('button', { name: 'Confirm Assignment' }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/sections/assign-instructor/', {
      section_ids: [4],
      instructor_id: 12,
    }))
    expect(await screen.findByText('Instructor assigned to 1 section.')).toBeTruthy()
    expect(screen.getAllByText('Rae Santos').length).toBeGreaterThan(0)
  })

  it('loads only the selected section roster and omits NFC identifiers', async () => {
    const user = userEvent.setup()
    render(<Sections />)

    await user.click((await screen.findAllByRole('button', { name: 'Show students for Section A' }))[0])

    expect(await screen.findAllByText('Mika Reyes')).toHaveLength(2)
    expect(api.get).toHaveBeenCalledWith('/users/', { params: { role: 'student', section: 4, page: 1 } })
    expect(screen.queryByText('SHOULD_NOT_DISPLAY')).toBeNull()
  })

  it('loads every paginated section before calculating summary counts', async () => {
    api.get.mockImplementation((path, { params } = {}) => {
      if (path === '/sections/' && params?.page === 1) return Promise.resolve({ data: { count: 2, next: 'http://localhost/api/sections/?page=2', results: [section] } })
      if (path === '/sections/' && params?.page === 2) return Promise.resolve({ data: { count: 2, next: null, results: [{ ...section, id: 5, section_name: 'Section B', subject_code: 'CS-202' }] } })
      if (path === '/users/') return Promise.resolve({ data: { count: 1, next: null, results: [instructor] } })
      throw new Error(`Unexpected GET ${path}`)
    })

    render(<Sections />)

    expect(await screen.findAllByText('Section B')).toHaveLength(2)
    expect(screen.getByText('2', { selector: 'p' })).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith('/sections/', { params: { page: 2 } })
  })
})