import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import Sections from './Sections.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }))

const section = {
  id: 4,
  section_name: 'Section A',
  subject_code: 'CS-101',
  program: 'BSCS',
  year_level: '2nd Year',
  academic_year: '2026-2027',
  status: 'Active',
  student_count: 12,
  activity_count: 3,
  instructor: null,
  instructor_name: null,
}
const overview = {
  section: { ...section, academic_year: '2026-2027' },
  counts: { students: 12, activities: 3, submitted: 8, expected: 36, missing: 28, late: 2, pending_review: 5 },
  students: [{ id: 21, first_name: 'Mika', last_name: 'Reyes', student_id: 'ST-21', is_active: true }],
  activities: [{ id: 31, title: 'Safety Activity', due_date: '2026-11-20T12:00:00Z' }],
  recent_submissions: [{ id: 41, student_name: 'Mika Reyes', activity_title: 'Safety Activity', submitted_at: '2026-11-10T12:00:00Z', status: 'submitted', score: null }],
  access_logs: [{ id: 51, student_name: 'Mika Reyes', station: 'Cabinet Station 1', status: 'success', access_time: '2026-11-10T12:00:00Z' }],
  cabinet_stations: [{ station: 'Cabinet Station 1', status: 'Available' }],
}
const instructor = { id: 12, role: 'instructor', first_name: 'Rae', last_name: 'Santos', instructor_id: 'INS-12', email: 'rae@example.test', is_active: true }

describe('Admin Sections', () => {
  beforeEach(() => {
    api.get.mockImplementation((path, { params } = {}) => {
      if (path === '/sections/') return Promise.resolve({ data: [section] })
      if (path === '/sections/4/overview/') return Promise.resolve({ data: overview })
      if (path === '/users/' && params?.role === 'student') return Promise.resolve({ data: [{ id: 21, first_name: 'Mika', last_name: 'Reyes', student_id: 'ST-21', section_year_level: '2nd Year', is_active: true, nfc_uid: 'SHOULD_NOT_DISPLAY' }] })
      if (path === '/activities/' && params?.section === 4) return Promise.resolve({ data: [overview.activities[0]] })
      if (path === '/submissions/' && params?.section === 4) return Promise.resolve({ data: [overview.recent_submissions[0]] })
      if (path === '/access-logs/' && params?.user__section === 4) return Promise.resolve({ data: [overview.access_logs[0]] })
      if (path === '/users/') return Promise.resolve({ data: { count: 1, next: null, results: [instructor] } })
      throw new Error(`Unexpected GET ${path}`)
    })
    api.patch.mockResolvedValue({ data: [{ ...section, instructor: instructor.id, instructor_name: 'Rae Santos' }] })
  })

  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('opens the centered section modal, restores scrolling, and supports Escape and reopen', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Sections /></MemoryRouter>)
    await user.click((await screen.findAllByRole('button', { name: 'Open actions for Section A' }))[0])
    await user.click((await screen.findAllByRole('menuitem', { name: 'View Details' }))[0])

    const dialog = await screen.findByRole('dialog', { name: 'Section Overview' })
    expect(within(dialog).getByText('Section A · CS-101')).toBeTruthy()
    expect(dialog.querySelector('.overflow-y-auto')).toBeTruthy()
    expect(within(dialog).getAllByRole('tab')).toHaveLength(5)
    expect(api.get).toHaveBeenCalledWith('/sections/4/overview/', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(document.body.style.overflow).toBe('hidden')
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'))
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Open actions for Section A'))
    const actionTrigger = screen.getAllByRole('button', { name: 'Open actions for Section A' })[0]
    await user.click(actionTrigger)
    await user.click((await screen.findAllByRole('menuitem', { name: 'View Details' }))[0])
    expect(await screen.findByRole('dialog', { name: 'Section Overview' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Section Overview' })).toBeNull())
  })

  it('shows backend data in all five section tabs', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Sections /></MemoryRouter>)
    await user.click((await screen.findAllByRole('button', { name: 'Open actions for Section A' }))[0])
    await user.click((await screen.findAllByRole('menuitem', { name: 'View Details' }))[0])
    const dialog = await screen.findByRole('dialog', { name: 'Section Overview' })

    expect(await within(dialog).findByText('8')).toBeTruthy()
    expect(within(dialog).getByText('Cabinet Station 1')).toBeTruthy()
    await user.click(within(dialog).getByRole('tab', { name: 'Students' }))
    expect(await within(dialog).findByText('Mika Reyes')).toBeTruthy()
    await user.click(within(dialog).getByRole('tab', { name: 'Activities' }))
    expect(await within(dialog).findByText('Safety Activity')).toBeTruthy()
    await user.click(within(dialog).getByRole('tab', { name: 'Submissions' }))
    expect(await within(dialog).findByRole('heading', { name: 'Section Submissions' })).toBeTruthy()
    await user.click(within(dialog).getByRole('tab', { name: 'Cabinet Access' }))
    expect(await within(dialog).findByRole('heading', { name: 'Cabinet Access' })).toBeTruthy()
  })

  it('opens assignment, loads registered instructors, and refreshes the assigned section', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Sections /></MemoryRouter>)
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
    render(<MemoryRouter><Sections /></MemoryRouter>)

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

    render(<MemoryRouter><Sections /></MemoryRouter>)

    expect(await screen.findAllByText('Section B')).toHaveLength(2)
    expect(screen.getByText('2', { selector: 'p' })).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith('/sections/', { params: { page: 2 } })
  })

  it('uses the two academic-year filters and creates sections without a Program field', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/sections/') return Promise.resolve({ data: [section, { ...section, id: 5, section_name: 'Section B', academic_year: '2027–2028' }] })
      if (path === '/users/?role=instructor') return Promise.resolve({ data: [] })
      throw new Error(`Unexpected GET ${path}`)
    })
    api.post.mockResolvedValue({ data: { ...section, id: 6, section_name: 'Section C', academic_year: '2026–2027' } })
    const user = userEvent.setup()
    render(<MemoryRouter><Sections /></MemoryRouter>)

    const yearFilter = await screen.findByRole('combobox', { name: 'Filter academic year' })
    expect(Array.from(yearFilter.options).map((option) => option.textContent)).toEqual([
      'All academic years', '2026–2027', '2027–2028',
    ])
    expect(screen.queryByText('Program')).toBeNull()
    await user.selectOptions(yearFilter, '2026–2027')
    expect(screen.getByText('1 result')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Add Section' }))
    await screen.findByRole('dialog', { name: 'Add Section' })
    const academicYear = screen.getByRole('combobox', { name: 'Academic year' })
    expect(Array.from(academicYear.options).map((option) => option.textContent)).toEqual([
      'Select academic year', '2026–2027', '2027–2028',
    ])
    expect(screen.queryByLabelText('Program')).toBeNull()
    await user.type(screen.getByLabelText(/Subject Code/), 'CS-303')
    await user.type(screen.getByLabelText(/Section name/), 'C')
    await user.selectOptions(screen.getByLabelText(/Year level/), '3rd Year')
    await user.selectOptions(academicYear, '2026–2027')
    await user.click(screen.getByRole('button', { name: 'Create section' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('program')
    expect(api.post.mock.calls[0][1].academic_year).toBe('2026–2027')
  })
})