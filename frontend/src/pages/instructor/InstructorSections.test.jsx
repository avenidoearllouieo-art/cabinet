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
  students: [],
  activities: [],
  recent_submissions: [],
  access_logs: [],
  cabinet_stations: [],
}

describe('InstructorSections shared section modal', () => {
  const originalOverflow = document.body.style.overflow

  beforeEach(() => {
    api.get.mockImplementation((path, { params } = {}) => {
      if (path === '/sections/') return Promise.resolve({ data: { count: 1, next: null, results: [section] } })
      if (path === '/sections/4/overview/') return Promise.resolve({ data: overview })
      if (path === '/users/' && params?.role === 'student') return Promise.resolve({ data: [{ id: 12, first_name: 'Student', last_name: 'One', student_id: 'STU-12', email: 'student@example.test', section_name: 'Section A', nfc_registered: true, nfc_uid: 'DO-NOT-RENDER', last_access_status: 'success', last_access_time: '2026-11-10T12:00:00Z' }] })
      if (path === '/activities/' && params?.section === 4) return Promise.resolve({ data: [{ id: 32, title: 'Safety Activity', activity_type: 'Assignment', status: 'Published', due_date: '2026-11-20T12:00:00Z' }] })
      if (path === '/submissions/' && params?.section === 4) return Promise.resolve({ data: [{ id: 51, activity: 32, student_name: 'Student', student_last_name: 'One', student_id: 'STU-12', activity_title: 'Safety Activity', submitted_at: '2026-11-10T12:00:00Z', submission_status: 'submitted', score: null, files: [{ id: 71, filename: 'worksheet.pdf', content_type: 'application/pdf', preview_kind: 'submission' }] }] })
      if (path === '/access-logs/' && params?.user__section === 4) return Promise.resolve({ data: [{ id: 61, student_name: 'Student One', station: 'Station 1', cabinet_name: 'North Cabinet', status: 'success', access_result: 'Success', access_time: '2026-11-10T12:00:00Z', nfc_uid: 'DO-NOT-RENDER' }] })
      throw new Error(`Unexpected GET ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    document.body.style.overflow = originalOverflow
    vi.resetAllMocks()
  })

  it('opens the centered shared modal, shows five tabs and section-scoped records', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><InstructorSections /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'View Section A section' }))
    const dialog = await screen.findByRole('dialog', { name: 'Section Overview' })
    expect(document.body.style.overflow).toBe('hidden')
    expect(within(dialog).getByText('Section A · CS-101')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toBeTruthy()
    expect(within(dialog).getAllByRole('tab')).toHaveLength(5)
    expect(within(dialog).getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    expect(within(dialog).queryByRole('button', { name: /Edit User/i })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Edit Section' })).toBeNull()

    await user.click(within(dialog).getByRole('tab', { name: 'Students' }))
    expect(await within(dialog).findByText('Student One')).toBeTruthy()
    expect(within(dialog).getByText('Registration Status')).toBeTruthy()
    expect(within(dialog).getByText('Cabinet Access Status')).toBeTruthy()
    expect(within(dialog).queryByText('DO-NOT-RENDER')).toBeNull()
    await user.click(within(dialog).getByRole('tab', { name: 'Activities' }))
    expect(await within(dialog).findByText('Safety Activity')).toBeTruthy()
    await user.click(within(dialog).getByRole('tab', { name: 'Submissions' }))
    expect(await within(dialog).findByText('Section Submissions')).toBeTruthy()
    expect(within(dialog).getByText('Attachments (1)')).toBeTruthy()
    await user.click(within(dialog).getByRole('tab', { name: 'Cabinet Access' }))
    expect(await within(dialog).findByText('North Cabinet')).toBeTruthy()
    expect(within(dialog).queryByText('DO-NOT-RENDER')).toBeNull()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Section Overview' })).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'View Section A section' }))
    expect(await screen.findByRole('dialog', { name: 'Section Overview' })).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: 'Close dialog' })[0])
    await waitFor(() => expect(document.body.style.overflow).toBe(originalOverflow))
  })
})
