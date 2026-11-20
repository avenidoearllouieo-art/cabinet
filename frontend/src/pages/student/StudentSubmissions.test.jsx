import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import StudentSubmissions from './StudentSubmissions.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('StudentSubmissions', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('combines search, status, sorting, paginated results, and reset', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/submissions/') {
        return Promise.resolve({ data: {
          count: 11,
          page_size: 10,
          next: 'http://localhost/api/submissions/?page=2',
          results: [{ id: 1, activity_title: 'Lab Report', submitted_at: '2026-10-10T00:00:00Z', status: 'submitted', files: [] }],
        } })
      }
      if (path === '/submissions/stats/') {
        return Promise.resolve({ data: { totalSubmissions: 11, underReview: 6, graded: 3, returnedForRevision: 1, lateSubmissions: 1 } })
      }
      throw new Error(`Unexpected GET ${path}`)
    })

    render(<MemoryRouter><StudentSubmissions /></MemoryRouter>)

    expect(await screen.findByText('Lab Report')).toBeTruthy()
    expect(screen.getByText('Showing 1 submission of 11 submissions')).toBeTruthy()
    const search = screen.getByRole('searchbox', { name: 'Search submissions' })
    const [status, sort] = screen.getAllByRole('combobox')
    fireEvent.change(search, { target: { value: 'Report' } })
    fireEvent.change(status, { target: { value: 'under_review' } })
    fireEvent.change(sort, { target: { value: 'submitted_at' } })

    await waitFor(() => {
      const request = api.get.mock.calls.find(([path, config]) => path === '/submissions/'
        && config.params.search === 'Report'
        && config.params.status === 'under_review'
        && config.params.ordering === 'submitted_at')
      expect(request).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }))
    await waitFor(() => {
      expect(search.value).toBe('')
      expect(status.value).toBe('all')
      expect(sort.value).toBe('-submitted_at')
    })
  })
})