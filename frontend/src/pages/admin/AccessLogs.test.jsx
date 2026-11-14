import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import AccessLogs from './AccessLogs.jsx'

vi.mock('../../services/api.js', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

describe('Access Logs Excel export', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it('exports filtered results by default and selected IDs when selected', async () => {
    const log = {
      id: 81,
      user: 10,
      username: 'student.10',
      student_name: 'Mina Example',
      student_id: 'STUDENT-10',
      role: 'student',
      section_name: 'Section A',
      access_time: '2026-11-14T08:30:00Z',
      station: 'Reader A',
      cabinet_name: 'Cabinet A',
      access_type: 'Cabinet Unlock',
      status: 'success',
      action: 'open',
      photo_capture_status: 'success',
      duration_seconds: 120,
    }
    api.get.mockResolvedValue({ data: { count: 1, next: null, results: [log] } })
    api.post.mockResolvedValue({ data: new Blob(['xlsx']) })
    const nativeUrl = globalThis.URL
    vi.stubGlobal('URL', Object.assign(class extends nativeUrl {}, {
      createObjectURL: vi.fn(() => 'blob:access-report'),
      revokeObjectURL: vi.fn(),
    }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<MemoryRouter><AccessLogs /></MemoryRouter>)

    await screen.findByRole('checkbox', { name: 'Select access log 81' })
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    await waitFor(() => expect(api.post).toHaveBeenNthCalledWith(
      1,
      '/access-logs/export-excel/',
      { ids: [81], scope: 'filtered' },
      { responseType: 'blob' },
    ))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select access log 81' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel (1 selected)' }))
    await waitFor(() => expect(api.post).toHaveBeenNthCalledWith(
      2,
      '/access-logs/export-excel/',
      { ids: [81], scope: 'selected' },
      { responseType: 'blob' },
    ))
  })
})