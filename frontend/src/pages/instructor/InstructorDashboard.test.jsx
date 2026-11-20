import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import InstructorDashboard from './InstructorDashboard.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('InstructorDashboard', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('counts active activity statuses and resolves assigned section names', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/dashboard/') return Promise.resolve({ data: { total_activities: 3, total_submissions: 4, pending_grading: 2 } })
      if (path === '/activities/') return Promise.resolve({ data: { count: 3, next: null, results: [
        { id: 1, title: 'Published lesson', status: 'Published', assigned_sections: [12], created_at: '2026-10-10T10:00:00Z' },
        { id: 2, title: 'Open lesson', status: 'Active', assigned_sections: [12], created_at: '2026-10-09T10:00:00Z' },
        { id: 3, title: 'Draft lesson', status: 'Draft', assigned_sections: [12], created_at: '2026-10-08T10:00:00Z' },
      ] } })
      if (path === '/sections/') return Promise.resolve({ data: { count: 1, next: null, results: [{ id: 12, section_name: 'Section A' }] } })
      if (path === '/submissions/') return Promise.resolve({ data: { count: 4, results: [] } })
      if (path === '/cabinet-sessions/station-status/') return Promise.resolve({ data: { stations: [] } })
      throw new Error(`Unexpected GET ${path}`)
    })

    render(<MemoryRouter><InstructorDashboard /></MemoryRouter>)

    expect(await screen.findByText('Published lesson')).toBeTruthy()
    const activeCard = screen.getByText('Active 2 Activities').closest('article')
    expect(activeCard.textContent).toContain('2')
    expect(screen.getAllByText('Section A')).toHaveLength(3)
  })
})