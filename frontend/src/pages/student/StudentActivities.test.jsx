import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import StudentActivities from './StudentActivities.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('StudentActivities', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
    localStorage.clear()
  })

  it('uses the Activities title, keeps the submit action, and formats missing deadlines safely', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/users/profile/') return Promise.resolve({ data: { id: 4, role: 'student', section: 9, section_name: 'Section A' } })
      if (path === '/activities/stats/') return Promise.resolve({ data: { total_activities: 2 } })
      if (path === '/activities/') return Promise.resolve({ data: {
        count: 2,
        page_size: 10,
        results: [
          { id: 1, title: 'No-deadline lab', instructor_name: 'Rae Santos', due_date: null, status: 'Published', student_submission_status: 'Not Submitted' },
          { id: 2, title: 'Invalid-date lab', due_date: 'not-a-date', status: 'Published', student_submission_status: 'Not Submitted' },
        ],
      } })
      throw new Error(`Unexpected GET ${path}`)
    })

    render(<MemoryRouter><StudentActivities /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Activities', level: 1 })).toBeTruthy()
    expect(screen.getByText('View your assigned activities, deadlines, and submission progress.')).toBeTruthy()
    expect(await screen.findByText('No-deadline lab')).toBeTruthy()
    expect(screen.getAllByText('No deadline')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Submit Activity' })).toHaveLength(2)
    expect(screen.queryByText(/Jan 1, 1970/)).toBeNull()
  })
})