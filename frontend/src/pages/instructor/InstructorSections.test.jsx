import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import InstructorSections from './InstructorSections.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

const section = { id: 4, section_id: 4, section_name: 'Section A', subject_code: 'CS-101', program: 'BSCS', year_level: '3', academic_year: '2026-2027', instructor_name: 'Instructor One', status: 'Active', student_count: 1, activity_count: 1, submitted_count: 1, expected_submission_count: 1, missing_count: 0, pending_review_count: 1 }
const overview = {
  section,
  counts: { students: 1, activities: 1, submitted: 1, expected: 1, missing: 0, late: 0, pending_review: 1 },
  students: [{ id: 12, first_name: 'Student', last_name: 'One', student_id: 'STU-12' }],
  activities: [{ id: 32, title: 'Safety Activity', status: 'Published', due_date: '2026-11-20T12:00:00Z' }],
  recent_submissions: [{ id: 51, student_name: 'Student', activity_title: 'Safety Activity', submitted_at: '2026-11-10T12:00:00Z', status: 'submitted', score: null }],
  access_logs: [{ id: 61, student_name: 'Student One', station: 'Station 1', status: 'success', access_time: '2026-11-10T12:00:00Z' }],
  cabinet_stations: [],
}

describe('InstructorSections detail drawer', () => {
  const originalOverflow = document.body.style.overflow

  beforeEach(() => {
    api.get.mockImplementation((path) => {
      if (path === '/sections/') return Promise.resolve({ data: { count: 1, next: null, results: [section] } })
      if (path === '/sections/4/overview/') return Promise.resolve({ data: overview })
      throw new Error(`Unexpected GET ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    document.body.style.overflow = originalOverflow
    vi.resetAllMocks()
  })

  it('keeps a visible header and close control while switching real-data tabs', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><InstructorSections /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'View Section A section' }))
    const drawer = await screen.findByRole('dialog', { name: 'Section A' })
    expect(document.body.style.overflow).toBe('hidden')
    expect(within(drawer).getByRole('button', { name: 'Close section drawer' })).toBeTruthy()
    expect(within(drawer).getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')

    await user.click(within(drawer).getByRole('tab', { name: 'Students' }))
    expect(within(drawer).getByText('Student One')).toBeTruthy()
    await user.click(within(drawer).getByRole('tab', { name: 'Submissions' }))
    expect(within(drawer).getByText('Recent submissions')).toBeTruthy()
    expect(within(drawer).getByText(/Safety Activity/)).toBeTruthy()
    await user.click(within(drawer).getByRole('tab', { name: 'Cabinet Access' }))
    expect(within(drawer).getByText('Historical cabinet access')).toBeTruthy()

    await user.click(within(drawer).getByRole('button', { name: 'Close section drawer' }))
    await waitFor(() => expect(document.body.style.overflow).toBe(originalOverflow))
  })
})
