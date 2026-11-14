import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import StudentDashboard from './StudentDashboard.jsx'

vi.mock('../../services/api.js', () => ({
  default: { get: vi.fn() },
}))

vi.mock('../../components/CabinetStationStatus', () => ({
  default: () => <div>Station status</div>,
}))

describe('StudentDashboard', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps the greeting in the heading and renders four statistics in one grid', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/users/profile/') {
        return Promise.resolve({ data: { first_name: 'Maya', username: 'maya' } })
      }
      if (path === '/dashboard/') {
        return Promise.resolve({
          data: {
            total_activities: 8,
            submitted_activities: 3,
            pending_activities: 5,
            cabinet_access_today: 2,
            upcoming_activities: [{
              id: 1,
              title: 'Field research report',
              section_name: 'BIO-101',
              due_date: new Date(Date.now() + 86400000).toISOString(),
              status: 'Pending',
            }, {
              id: 2,
              title: 'Malformed deadline item',
              due_date: 'not-a-date',
              status: 'Pending',
            }],
            recent_submissions: [],
            recent_access_logs: [],
          },
        })
      }
      return Promise.resolve({ data: [] })
    })

    const { container } = render(
      <MemoryRouter>
        <StudentDashboard />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Assigned Activities')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Student Dashboard' })).toBeTruthy()
    expect(screen.getByText(/Welcome back, Maya\./)).toBeTruthy()
    expect(screen.queryByText('Welcome back')).toBeNull()
    const statsGrid = container.querySelector('.dashboard-stat-grid')
    expect(statsGrid).toBeTruthy()
    expect(statsGrid.children).toHaveLength(4)
    expect(statsGrid.textContent).toContain('Submitted')
    expect(statsGrid.textContent).toContain('Pending')
    expect(statsGrid.textContent).toContain('Cabinet Access Today')
    expect(screen.getByRole('region', { name: 'Upcoming activities table' })).toBeTruthy()
    expect((await screen.findAllByText('Date unavailable')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Jan 1, 1970/)).toBeNull()
  })
})
