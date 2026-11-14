import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import InstructorAccessLogs from './InstructorAccessLogs.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('InstructorAccessLogs', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('uses Access History labels and searches real records without UID controls', async () => {
    const log = {
      id: 2,
      student_name: 'Casey Alpha',
      student_id: 'LOG-2',
      section_name: 'Section A',
      cabinet_name: 'Cabinet Alpha',
      access_time: '2026-11-13T16:30:00Z',
      status: 'success',
      access_result: 'Success',
      nfc_uid: 'UID-MUST-NOT-DISPLAY',
    }
    api.get.mockImplementation((path) => {
      if (path === '/access-logs/') return Promise.resolve({ data: { results: [log], count: 1 } })
      if (path === '/access-logs/stats/') return Promise.resolve({ data: { total_accesses_today: 1, successful_accesses_today: 1, failed_accesses_today: 0, active_students_today: 1 } })
      if (path === '/access-logs/filter-options/') return Promise.resolve({ data: { cabinets: ['Cabinet Alpha'] } })
      if (path === '/sections/') return Promise.resolve({ data: [{ id: 3, section_name: 'Section A' }] })
      throw new Error(`Unexpected GET ${path}`)
    })

    render(<MemoryRouter><InstructorAccessLogs /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Access History' })).toBeTruthy()
    expect(screen.getByText('Monitor cabinet access activity for students in your assigned sections.')).toBeTruthy()
    expect(await screen.findByText('Casey Alpha')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search logs' }).getAttribute('placeholder')).toBe('Search student ID, name, or cabinet')
    expect(screen.queryByText('Card UID')).toBeNull()
    expect(screen.queryByText('UID-MUST-NOT-DISPLAY')).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search logs' }), { target: { value: 'Casey' } })
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/access-logs/', expect.objectContaining({
      params: expect.objectContaining({ search: 'Casey' }),
    })))
    const requests = api.get.mock.calls.filter(([path]) => path === '/access-logs/')
    expect(requests.every(([, options]) => !Object.hasOwn(options.params, 'nfc_uid'))).toBe(true)
  })
})