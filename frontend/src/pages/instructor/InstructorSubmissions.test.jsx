import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import InstructorSubmissions from './InstructorSubmissions.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

const submission = {
  id: 21,
  student_id: 'STU-21',
  student_name: 'Jordan',
  student_last_name: 'Lee',
  student_section: 'Section A',
  activity_title: 'Cabinet Safety',
  submitted_at: '2026-10-10T10:00:00Z',
  status: 'submitted',
  score: null,
  feedback: '',
  max_score: 100,
}

describe('InstructorSubmissions', () => {
  beforeEach(() => {
    api.get.mockImplementation((path) => {
      if (path === '/sections/' || path === '/activities/') return Promise.resolve({ data: { count: 0, next: null, results: [] } })
      if (path === '/submissions/') return Promise.resolve({ data: { count: 1, next: null, results: [submission] } })
      if (path === '/submissions/stats/') return Promise.resolve({ data: { totalSubmissions: 1, pendingReview: 1, graded: 0, lateSubmissions: 0 } })
      throw new Error(`Unexpected GET ${path}`)
    })
    api.post.mockResolvedValue({ data: { ...submission, score: 92, feedback: 'Good work', graded_by: 3 } })
  })

  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('keeps the compact student cell and visible actions, then refreshes after grading', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><InstructorSubmissions /></MemoryRouter>)

    expect(await screen.findByText('Jordan Lee')).toBeTruthy()
    expect(screen.getByText('STU-21')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Student' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Last Updated' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Grade' }))
    await screen.findByRole('dialog', { name: 'Grade Submission' })
    await user.type(await screen.findByRole('spinbutton'), '92')
    await user.type(await screen.findByLabelText('Feedback'), 'Good work')
    await user.click(screen.getByRole('button', { name: 'Save grade' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/submissions/21/grade/', { score: 92, feedback: 'Good work' }))
    expect(await screen.findByText('Submission grade saved successfully.')).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith('/submissions/stats/', expect.any(Object))
  })
})