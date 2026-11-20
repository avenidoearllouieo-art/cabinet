import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import Submissions from './Submissions.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('Admin Submissions', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('uses four view-only filters and clears the Manila date filter', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/submissions/') return Promise.resolve({ data: { count: 1, next: null, results: [{
        id: 8,
        student_name: 'Student',
        student_last_name: 'Alvarez',
        student_id: 'ST-8',
        activity_title: 'Lab Report',
        submitted_at: '2026-08-11T03:00:00Z',
        score: null,
      }] } })
      if (path === '/submissions/stats/') return Promise.resolve({ data: { totalSubmissions: 1, pendingReview: 1, graded: 0, lateSubmissions: 0 } })
      if (path === '/activities/') return Promise.resolve({ data: { count: 1, next: null, results: [{ id: 2, title: 'Lab Report' }] } })
      throw new Error(`Unexpected GET ${path}`)
    })

    render(<MemoryRouter><Submissions /></MemoryRouter>)

    expect(await screen.findByText('Lab Report')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search submissions' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Filter activity' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Filter submission status' })).toBeTruthy()
    expect(screen.getByLabelText('Submission date')).toBeTruthy()
    expect(screen.queryByLabelText('Sort submissions')).toBeNull()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/submissions/', expect.objectContaining({
      params: expect.objectContaining({ ordering: '-submitted_at' }),
    })))

    fireEvent.change(screen.getByLabelText('Submission date'), { target: { value: '2026-08-11' } })
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/submissions/', expect.objectContaining({
      params: expect.objectContaining({ submission_date: '2026-08-11' }),
    })))
    fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }))
    await waitFor(() => {
      const request = api.get.mock.calls.filter(([path]) => path === '/submissions/').at(-1)
      expect(request[1].params).not.toHaveProperty('submission_date')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Student Alvarez' }))
    expect(await screen.findByRole('menuitem', { name: 'View' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
  })
})