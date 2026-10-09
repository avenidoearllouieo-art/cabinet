import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'

function jsonResponse(payload, status = 200) {
  const body = JSON.stringify(payload)
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => body,
  }
}

function createFetchForStation(station, djangoEventId) {
  const fetcher = vi.fn(async (url, options = {}) => {
    if (url === '/api/cabinet/workflow/' && options.method !== 'POST') {
      return jsonResponse({
        mode: 'mock',
        cabinet_name: 'Cabinet 1',
        stations: ['Station 1', 'Station 2'].map((name) => ({
          name,
          status: 'available',
          session: null,
        })),
      })
    }
    if (url === '/api/cabinet/workflow/' && options.method === 'POST') {
      const request = JSON.parse(options.body)
      return jsonResponse({
        station: request.station,
        session: {
          id: `session-${request.station}`,
          station: request.station,
          status: 'open',
          workflow_state: 'opening',
          opened_by: [],
        },
      })
    }
    if (url === '/api/verify-nfc/') {
      return jsonResponse({
        success: true,
        event_id: djangoEventId,
        nfc_uid: `UID-${station.replace(' ', '-')}`,
        name: `${station} Student`,
        student_id: `${station.replace(' ', '')}-STUDENT`,
        role: 'student',
        station: { name: station },
      })
    }
    if (url === `/api/access-logs/${djangoEventId}/photo/`) {
      return jsonResponse({ error: 'Photo service unavailable.' }, 503)
    }
    throw new Error(`Unexpected Cabinet integration request: ${url}`)
  })
  return fetcher
}

function createFetchForCloseStation(djangoEventId, memberUid) {
  return vi.fn(async (url, options = {}) => {
    if (url === '/api/cabinet/workflow/' && options.method !== 'POST') {
      return jsonResponse({
        mode: 'mock',
        cabinet_name: 'Cabinet 1',
        stations: [
          { name: 'Station 1', status: 'available', session: null },
          {
            name: 'Station 2',
            status: 'occupied',
            session: {
              id: 'session-Station 2',
              station: 'Station 2',
              status: 'open',
              workflow_state: 'idle',
              opened_by: [{ uid: memberUid, studentId: 'Station2-STUDENT', fullName: 'Station 2 Student' }],
              closed_by: [],
            },
          },
        ],
      })
    }
    if (url === '/api/cabinet/workflow/' && options.method === 'POST') {
      return jsonResponse({
        station: 'Station 2',
        session: {
          id: 'session-Station 2',
          station: 'Station 2',
          status: 'open',
          workflow_state: 'closing',
          opened_by: [{ uid: memberUid, studentId: 'Station2-STUDENT', fullName: 'Station 2 Student' }],
          closed_by: [],
        },
      })
    }
    if (url === '/api/verify-nfc/') {
      return jsonResponse({
        success: true,
        event_id: djangoEventId,
        nfc_uid: memberUid,
        name: 'Station 2 Student',
        student_id: 'Station2-STUDENT',
        role: 'student',
        station: { name: 'Station 2' },
      })
    }
    if (url === `/api/access-logs/${djangoEventId}/photo/`) {
      return jsonResponse({ error: 'Photo service unavailable.' }, 503)
    }
    throw new Error(`Unexpected Cabinet close integration request: ${url}`)
  })
}

describe('Cabinet photo scan integration', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it.each([
    ['Station 1', 4101],
    ['Station 2', 4202],
  ])('keeps %s attendance when the photo status API fails', async (station, djangoEventId) => {
    const fetcher = createFetchForStation(station, djangoEventId)
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /open cabinet/i }))
    await user.click(screen.getByText(station.toUpperCase()).closest('button'))
    await user.type(await screen.findByLabelText('Mock NFC UID'), `UID-${station.replace(' ', '-')}`)
    await user.click(screen.getByRole('button', { name: 'CHECK NFC' }))

    await waitFor(() => expect(screen.getAllByText(`${station} Student`).length).toBeGreaterThanOrEqual(2))
    expect(await screen.findByText('Participants scanned: 1')).toBeTruthy()
    expect(within(await screen.findByLabelText('Access photo details')).getByText('Unavailable')).toBeTruthy()
    expect(screen.getByText('No photo is available for this scan.')).toBeTruthy()
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      `/api/access-logs/${djangoEventId}/photo/`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-TapTrack-Mock-Mode': 'true' }),
      }),
    ))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('records Station 2 closing attendance when the photo status API fails', async () => {
    const memberUid = 'UID-STATION-2-MEMBER'
    const fetcher = createFetchForCloseStation(5202, memberUid)
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /close cabinet/i }))
    await user.click(await screen.findByRole('button', { name: /close station 2/i }))
    await user.type(await screen.findByLabelText('Mock NFC UID'), memberUid)
    await user.click(screen.getByRole('button', { name: 'CHECK NFC' }))

    await waitFor(() => expect(screen.getAllByText('Closed by').length).toBe(2))
    const closedCountRow = screen.getAllByText('Closed by')[0].closest('.confirm-row')
    expect(within(closedCountRow).getByText('1')).toBeTruthy()
    expect(within(await screen.findByLabelText('Access photo details')).getByText('Unavailable')).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith(
      '/api/access-logs/5202/photo/',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-TapTrack-Mock-Mode': 'true' }),
      }),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})