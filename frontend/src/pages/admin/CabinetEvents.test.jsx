import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import CabinetEvents from './CabinetEvents.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

const session = {
  id: 91,
  station: 'Station 1',
  opened_by: [{ fullName: 'Mika Reyes', section: 'BSIT-IOT' }],
  closed_by: [{ fullName: 'Ana Lopez', section: 'BSIT-IOT' }],
  session_initiator: { fullName: 'Mika Reyes', section: 'BSIT-IOT' },
  closing_initiator: { fullName: 'Ana Lopez', section: 'BSIT-IOT' },
  opened_at: '2026-11-29T00:19:00Z',
  closed_at: '2026-11-29T00:34:00Z',
  duration_seconds: 900,
  participant_count: 1,
  opening_attendance_count: 1,
  closing_attendance_count: 1,
  status: 'closed',
  motor_command_outcome: 'Not recorded',
  physical_movement_status: 'Not verified',
  attendance: [],
}

describe('Cabinet Sessions table', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('uses the session column layout and expands from the left control', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/cabinet-sessions/') return Promise.resolve({ data: { count: 1, next: null, previous: null, results: [session] } })
      if (path === '/cabinet-sessions/stats/') return Promise.resolve({ data: { active_sessions: 0, completed_sessions: 1, average_completed_duration_seconds: 900, sessions_pending_closing_attendance: 0 } })
      throw new Error(`Unexpected GET ${path}`)
    })

    render(<MemoryRouter><CabinetEvents /></MemoryRouter>)

    expect(await screen.findByText('Mika Reyes')).toBeTruthy()
    expect(screen.getByText('Ana Lopez')).toBeTruthy()
    expect(screen.getByText('Cabinet Session Records')).toBeTruthy()

    for (const label of ['Session ID', 'Station', 'Opened by', 'Closed by', 'Opening time', 'Closing time', 'Duration', 'Participants', 'Status', 'Actions']) {
      expect(screen.getByText(label)).toBeTruthy()
    }

    const expand = screen.getByRole('button', { name: 'Expand row 1' })
    fireEvent.click(expand)
    expect(await screen.findByText('Opening initiator')).toBeTruthy()

    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy()
  })
})
