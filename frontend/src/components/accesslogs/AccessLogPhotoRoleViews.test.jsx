import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import AdminAccessLogs from '../../pages/admin/AccessLogs.jsx'
import InstructorAccessLogs from '../../pages/instructor/InstructorAccessLogs.jsx'
import StudentAccessLogs from '../../pages/student/StudentAccessLogs.jsx'

vi.mock('../../services/api.js', () => ({
  default: {
    defaults: { baseURL: '/api' },
    get: vi.fn(),
    delete: vi.fn(),
  },
}))

const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })

function makeLog(id) {
  return {
    id,
    user: 14,
    username: 'photo-student',
    role: 'student',
    student_id: 'STU-014',
    student_name: 'Jordan Student',
    section_name: 'Section A',
    cabinet_name: 'Cabinet 1',
    station: 'Station 1',
    nfc_uid: 'UID-014',
    status: 'success',
    access_result: 'Success',
    access_type: 'Cabinet Opened',
    access_time: '2026-10-20T10:00:00Z',
    photo_capture_status: 'success',
  }
}

function mockRoleApi(log) {
  api.get.mockImplementation(async (path) => {
    if (path === '/access-logs/') return { data: { results: [log], count: 1 } }
    if (path === '/access-logs/stats/') return { data: {} }
    if (path === '/access-logs/filter-options/') return { data: { cabinets: [] } }
    if (path === '/sections/') return { data: [] }
    if (path === `/access-logs/${log.id}/`) return { data: log }
    if (path === `/access-logs/${log.id}/photo/`) {
      return { data: {
        event_id: log.id,
        capture_status: 'success',
        captured_at: '2026-10-20T10:00:00Z',
        image_available: true,
        image_endpoint: `/api/access-logs/${log.id}/photo/image/`,
      } }
    }
    if (path === `/access-logs/${log.id}/photo/image/`) {
      return { data: jpeg, headers: { 'content-type': 'image/jpeg' } }
    }
    throw new Error(`Unexpected role access-log request: ${path}`)
  })
}

describe('access-log photo role views', () => {
  beforeEach(() => {
    api.get.mockReset()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:role-access-photo'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each([
    ['Admin', AdminAccessLogs, 501, 'View Access Log'],
    ['Instructor', InstructorAccessLogs, 502, 'Cabinet Access Log Details'],
    ['Student', StudentAccessLogs, 503, 'Cabinet Access Log Details'],
  ])('%s displays its own row photo and event details photo', async (role, Page, eventId, dialogName) => {
    const user = userEvent.setup()
    const log = makeLog(eventId)
    mockRoleApi(log)
    const page = role === 'Admin'
      ? <MemoryRouter><Page /></MemoryRouter>
      : role === 'Instructor'
        ? <MemoryRouter><Page /></MemoryRouter>
        : <Page />
    render(page)

    const rowThumbnail = await screen.findByRole('img', { name: `Access event ${eventId} photo thumbnail` })
    expect(rowThumbnail.getAttribute('src')).toBe('blob:role-access-photo')

    if (role === 'Admin') {
      await user.click(screen.getByRole('button', { name: 'Open access log actions' }))
      await user.click(screen.getByRole('button', { name: 'View Details' }))
    } else {
      const actionButton = screen.getByRole('button', { name: /View Details/i })
      await user.click(actionButton)
    }

    const details = await screen.findByRole('dialog', { name: dialogName })
    expect(within(details).getByRole('img', { name: `Access event ${eventId} photo thumbnail` })).toBeTruthy()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(`/access-logs/${eventId}/photo/image/`, expect.any(Object)))
    expect(api.get).toHaveBeenCalledWith(`/access-logs/${eventId}/photo/`, expect.any(Object))
  })
})