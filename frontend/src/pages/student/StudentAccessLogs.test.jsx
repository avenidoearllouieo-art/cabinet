import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import StudentAccessLogs from './StudentAccessLogs.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('StudentAccessLogs', () => {
  beforeEach(() => {
    api.get.mockImplementation((path) => {
      if (path === '/access-logs/stats/') {
        return Promise.resolve({
          data: {
            total_accesses_today: 1,
            successful_accesses_today: 1,
            failed_accesses_today: 0,
            active_students_today: 1,
          },
        })
      }

      if (path === '/access-logs/') {
        return Promise.resolve({
          data: {
            count: 1,
            page_size: 10,
            results: [{
              id: 1,
              access_time: '2026-10-04T15:04:00Z',
              cabinet_name: 'Station 1',
              status: 'success',
              nfc_uid: 'ABCD123456',
              photo_capture_status: 'captured',
            }],
          },
        })
      }

      throw new Error(`Unexpected GET ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('shows a combined date-time value and masks the student NFC value', async () => {
    render(<MemoryRouter><StudentAccessLogs /></MemoryRouter>)

    const expectedDateTime = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date('2026-10-04T15:04:00Z'))

    expect(await screen.findAllByText(expectedDateTime, { selector: 'span' })).toHaveLength(1)
    expect(screen.queryByText('ABCD123456')).toBeNull()
    expect(screen.getAllByText('••••3456', { selector: 'span' }).length).toBeGreaterThan(0)
  })
})
