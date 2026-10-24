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

function createFetchForStation(station, djangoEventId, { photoAvailable = false } = {}) {
  let photoStatusReads = 0
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
    if (url === 'http://127.0.0.1:5001/photo/capture') {
      const request = JSON.parse(options.body)
      return jsonResponse({ success: true, event_id: request.event_id })
    }
    if (url === `/api/access-logs/${djangoEventId}/photo/`) {
      if (photoAvailable) {
        photoStatusReads += 1
        return jsonResponse(photoStatusReads === 1
          ? {
            event_id: djangoEventId,
            capture_status: 'pending',
            image_available: false,
            image_endpoint: null,
          }
          : {
            event_id: djangoEventId,
            capture_status: 'success',
            image_available: true,
            image_endpoint: `/api/access-logs/${djangoEventId}/photo/image/`,
          })
      }
      return jsonResponse({ error: 'Photo service unavailable.' }, 503)
    }
    if (url === `/api/access-logs/${djangoEventId}/photo/image/`) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        blob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }),
      }
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
    if (url === 'http://127.0.0.1:5001/photo/capture') {
      const request = JSON.parse(options.body)
      return jsonResponse({ success: true, event_id: request.event_id })
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
    expect(within(await screen.findByLabelText('Access photo details')).getByText('Pending')).toBeTruthy()
    expect(screen.getByText('Photo capture is pending.')).toBeTruthy()
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      `/api/access-logs/${djangoEventId}/photo/`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-TapTrack-Mock-Mode': 'true' }),
      }),
    ))
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:5001/photo/capture',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ event_id: djangoEventId }),
      }),
    ))
  })

  it('captures the cabinet-opening scan event and refreshes the image display', async () => {
    const djangoEventId = 4303
    const fetcher = createFetchForStation('Station 1', djangoEventId, { photoAvailable: true })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /open cabinet/i }))
    await user.click(screen.getByText('STATION 1').closest('button'))
    await user.type(await screen.findByLabelText('Mock NFC UID'), 'CABINET-OPEN-STUDENT')
    await user.click(screen.getByRole('button', { name: 'CHECK NFC' }))

    expect(await screen.findByRole('img', { name: 'Captured access event' })).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:5001/photo/capture',
      expect.objectContaining({ body: JSON.stringify({ event_id: djangoEventId }) }),
    )
    expect(fetcher).toHaveBeenCalledWith(
      `/api/access-logs/${djangoEventId}/photo/image/`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
  })

  it('reports open workflow completion without claiming physical movement', async () => {
    const fetcher = createFetchForStation('Station 1', 4304)
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /open cabinet/i }))
    await user.click(screen.getByText('STATION 1').closest('button'))
    await user.type(await screen.findByLabelText('Mock NFC UID'), 'OPEN-WORKFLOW-STUDENT')
    await user.click(screen.getByRole('button', { name: 'CHECK NFC' }))
    await user.click(await screen.findByRole('button', { name: 'CONTINUE' }))
    await user.click(await screen.findByRole('button', { name: 'OPEN CABINET' }))

    expect(await screen.findByRole('heading', { name: 'Open Workflow Complete' })).toBeTruthy()
    expect(screen.getByText(/physical shutter movement was not verified/i)).toBeTruthy()
  })

  it('uses Django registration URLs for the QR link without applying a Cabinet URL override', async () => {
    const registrationUrl = 'http://10.109.175.241:5177/register?token=enrollment-token-123'
    const fetcher = vi.fn(async (url, options = {}) => {
      if (url === '/api/cabinet/workflow/' && options.method !== 'POST') {
        return jsonResponse({
          mode: 'mock',
          cabinet_name: 'Cabinet 1',
          stations: ['Station 1', 'Station 2'].map((name) => ({ name, status: 'available', session: null })),
        })
      }
      if (url === '/api/cabinet/workflow/' && options.method === 'POST') {
        const request = JSON.parse(options.body)
        return jsonResponse({ station: request.station, session: null })
      }
      if (url === '/api/verify-nfc/') {
        return jsonResponse({ registration_required: true, registration_url: registrationUrl }, 404)
      }
      throw new Error(`Unexpected Cabinet integration request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(await screen.findByRole('button', { name: /open cabinet/i }))
    await user.click(screen.getByText('STATION 1').closest('button'))
    await user.type(await screen.findByLabelText('Mock NFC UID'), 'UNREGISTERED-CARD')
    await user.click(screen.getByRole('button', { name: 'CHECK NFC' }))

    expect(container.querySelector('.registration-qr svg')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'REGISTER THIS CARD' }))
    const registrationFrame = screen.getByTitle('NFC card registration')
    expect(registrationFrame.getAttribute('src')).toBe(registrationUrl)
    expect(screen.getByRole('link', { name: /open registration in this cabinet window/i }).getAttribute('href')).toBe(registrationUrl)
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
    expect(within(await screen.findByLabelText('Access photo details')).getByText('Pending')).toBeTruthy()
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

  it('keeps attendance details visible on the closed-session result screen', async () => {
    const member = { uid: 'MEMBER-UID-200', studentId: 'MEMBER-200', fullName: 'Riley Member' }
    const openedSession = {
      id: 'session-Station 2',
      station: 'Station 2',
      status: 'open',
      workflow_state: 'idle',
      opened_at: '2026-10-15T10:00:00Z',
      opened_by: [member],
      closed_by: [],
    }
    const fetcher = vi.fn(async (url, options = {}) => {
      if (url === '/api/cabinet/workflow/' && options.method !== 'POST') {
        return jsonResponse({
          mode: 'mock',
          cabinet_name: 'Cabinet 1',
          stations: [
            { name: 'Station 1', status: 'available', session: null },
            { name: 'Station 2', status: 'occupied', session: openedSession },
          ],
        })
      }
      if (url === '/api/cabinet/workflow/' && options.method === 'POST') {
        const { command } = JSON.parse(options.body)
        const session = command === 'finish_close'
          ? { ...openedSession, status: 'closed', workflow_state: 'idle', closed_at: '2026-10-15T10:30:00Z', closed_by: [member] }
          : { ...openedSession, workflow_state: 'closing' }
        return jsonResponse({ station: 'Station 2', session })
      }
      if (url === '/api/verify-nfc/') {
        return jsonResponse({
          success: true,
          event_id: 6202,
          nfc_uid: member.uid,
          name: member.fullName,
          student_id: member.studentId,
          role: 'student',
        })
      }
      if (url === '/api/access-logs/6202/photo/') return jsonResponse({ error: 'Photo service unavailable.' }, 503)
      throw new Error(`Unexpected Cabinet integration request: ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /close cabinet/i }))
    await user.click(await screen.findByRole('button', { name: /close station 2/i }))
    await user.type(await screen.findByLabelText('Mock NFC UID'), member.uid)
    await user.click(screen.getByRole('button', { name: 'CHECK NFC' }))
    await user.click(await screen.findByRole('button', { name: 'CLOSE CABINET' }))
    await user.click(await screen.findByRole('button', { name: 'CLOSE STATION 2' }))

    expect(await screen.findByRole('heading', { name: 'Close Workflow Complete' })).toBeTruthy()
    expect(screen.getByText(/physical shutter movement was not verified/i)).toBeTruthy()
    expect(screen.getAllByText('Opened by')[0].parentElement.textContent).toContain('1')
    expect(screen.getAllByText('Closed by')[0].parentElement.textContent).toContain('1')
    expect(screen.getAllByText(member.fullName)).toHaveLength(2)
    expect(screen.getAllByText(member.studentId)).toHaveLength(2)
  })
})