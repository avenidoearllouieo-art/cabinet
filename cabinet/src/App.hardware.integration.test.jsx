import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'
import { motorDispatchStatus } from './utils/motorDispatchStatus.js'

vi.mock('./services/nfc/nfcMode', () => ({
  resolveNfcMode: () => 'hardware',
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Cabinet motor dispatch reporting', () => {
  it('reports missing dispatch metadata as unavailable, never successful', () => {
    const message = motorDispatchStatus(undefined, 'finish_open')

    expect(message).toMatch(/Motor dispatch unavailable/i)
    expect(message).toMatch(/does not confirm motor transmission/i)
    expect(message).not.toMatch(/motor dispatched/i)
  })

  it('distinguishes disabled, failed, dispatched, and unknown outcomes', () => {
    expect(motorDispatchStatus({
      workflow_action: 'finish_open',
      outcome: 'rejected',
      serial_command_sent: false,
      error: 'Motor actuation is disabled; no serial command was sent.',
    }, 'finish_open')).toMatch(/Motor dispatch disabled/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_close',
      outcome: 'rejected',
      serial_command_sent: false,
      error: 'Serial device permission denied.',
    }, 'finish_close')).toMatch(/Motor dispatch failed/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_open',
      outcome: 'completed',
      serial_command_sent: true,
    }, 'finish_open')).toMatch(/Motor dispatched/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_close',
      outcome: 'uncertain',
      serial_command_sent: null,
    }, 'finish_close')).toMatch(/Motor outcome unknown/i)
  })
})

describe('Cabinet real NFC bridge mode', () => {
  it('shows bridge unavailability and never renders mock UID controls', async () => {
    const fetcher = vi.fn(async (url) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://127.0.0.1:5001/cabinet/workflow') {
        return new Response(JSON.stringify({
          mode: 'hardware',
          cabinet_name: 'Cabinet 1',
          stations: [
            { name: 'Station 1', status: 'available', session: null },
            { name: 'Station 2', status: 'available', session: null },
          ],
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://127.0.0.1:5001/api/scans')) {
        throw new TypeError('Failed to fetch')
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByRole('status').some((element) => (
        element.textContent.includes('NFC bridge unavailable. Check the NFC service connection.')
      ))).toBe(true)
    })
    expect(screen.getByRole('alert').textContent).toContain('NFC bridge unavailable. Check the NFC service connection.')
    expect(screen.queryByLabelText('Mock NFC UID')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use Pi mock reader' })).toBeNull()
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:5001/cabinet/workflow',
      expect.objectContaining({ method: 'GET' }),
    )
    const workflowRequest = fetcher.mock.calls.find(([url]) => String(url).endsWith('/cabinet/workflow'))
    expect(workflowRequest?.[1]?.headers?.['X-API-Key']).toBeUndefined()
    expect(screen.queryByText('The mock NFC service could not verify the card.')).toBeNull()
    await waitFor(() => expect(fetcher.mock.calls.some(([url, options]) => (
      String(url).startsWith('http://127.0.0.1:5001/api/scans') && options.method === 'GET'
    ))).toBe(true))
  })
  it('does not show open workflow success when Django rejects the final transition', async () => {
    let scanPolls = 0
    const fetcher = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://127.0.0.1:5001/cabinet/workflow') {
        if (options.method === 'GET') {
          return new Response(JSON.stringify({
            mode: 'hardware',
            cabinet_name: 'Cabinet 1',
            stations: [
              { name: 'Station 1', status: 'available', session: null },
              { name: 'Station 2', status: 'available', session: null },
            ],
          }), { status: 200 })
        }
        const { command, station } = JSON.parse(options.body)
        if (command === 'open') {
          return new Response(JSON.stringify({
            mode: 'hardware',
            station,
            session: { id: 21, station, status: 'open', workflow_state: 'opening', opened_by: [], closed_by: [] },
          }), { status: 200 })
        }
        return new Response(JSON.stringify({ error: 'Django rejected final transition.' }), { status: 409 })
      }
      if (requestUrl.startsWith('http://127.0.0.1:5001/api/scans')) {
        scanPolls += 1
        const events = scanPolls < 2 ? [] : [{
          event_id: 1,
          uid: 'REAL-BRIDGE-UID',
          status: 'registered',
          name: 'Hardware Test Student',
          student_id: 'HW-001',
          role: 'student',
        }]
        const after = Number(new URL(requestUrl).searchParams.get('after'))
        return new Response(JSON.stringify({
          events,
          next_cursor: events.length ? 1 : after,
          has_more: false,
        }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /open cabinet/i }))
    await user.click(screen.getByText('STATION 1').closest('button'))
    await screen.findAllByText('Hardware Test Student')
    await user.click(screen.getByRole('button', { name: 'CONTINUE' }))
    await user.click(screen.getByRole('button', { name: 'OPEN CABINET' }))

    expect(await screen.findByText('Django rejected final transition.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Open Workflow Complete' })).toBeNull()
  })

  it('advances after a valid backend workflow response without claiming shutter movement', async () => {
    const openingSession = {
      id: 22,
      station: 'Station 1',
      status: 'open',
      workflow_state: 'opening',
      opened_by: [{ uid: 'REAL-BRIDGE-UID', studentId: 'HW-001', fullName: 'Hardware Test Student' }],
      closed_by: [],
    }
    const fetcher = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://127.0.0.1:5001/cabinet/workflow') {
        if (options.method === 'GET') {
          return new Response(JSON.stringify({
            mode: 'hardware',
            cabinet_name: 'Cabinet 1',
            stations: [
              { name: 'Station 1', status: 'occupied', session: openingSession },
              { name: 'Station 2', status: 'available', session: null },
            ],
          }), { status: 200 })
        }
        const { command, station } = JSON.parse(options.body)
        expect(command).toBe('finish_open')
        return new Response(JSON.stringify({
          mode: 'hardware',
          station,
          session: {
            ...openingSession,
            station,
            status: 'open',
            workflow_state: 'idle',
          },
          motor_dispatch: {
            workflow_action: 'finish_open',
            outcome: 'completed',
            serial_command_sent: true,
            serial_connection: 'connected',
            physical_movement_verified: false,
            error: null,
          },
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://127.0.0.1:5001/api/scans')) {
        const after = Number(new URL(requestUrl).searchParams.get('after'))
        return new Response(JSON.stringify({
          events: [],
          next_cursor: after,
          has_more: false,
        }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /open cabinet/i }))
    await user.click(screen.getByText('STATION 1').closest('button'))
    await user.click(screen.getByRole('button', { name: 'CONTINUE' }))
    await user.click(screen.getByRole('button', { name: 'OPEN CABINET' }))

    expect(await screen.findByRole('heading', { name: 'Open Workflow Complete' })).toBeTruthy()
    expect(screen.getByText(/ESP32 completed its command sequence. Physical shutter position was not verified/i)).toBeTruthy()
  })

  it('shows when Django completed Open but motor dispatch was disabled', async () => {
    const openingSession = {
      id: 23,
      station: 'Station 1',
      status: 'open',
      workflow_state: 'opening',
      opened_by: [{ uid: 'REAL-BRIDGE-UID', studentId: 'HW-001', fullName: 'Hardware Test Student' }],
      closed_by: [],
    }
    const fetcher = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://127.0.0.1:5001/cabinet/workflow') {
        if (options.method === 'GET') {
          return new Response(JSON.stringify({
            mode: 'hardware',
            cabinet_name: 'Cabinet 1',
            stations: [
              { name: 'Station 1', status: 'occupied', session: openingSession },
              { name: 'Station 2', status: 'available', session: null },
            ],
          }), { status: 200 })
        }
        return new Response(JSON.stringify({
          mode: 'hardware',
          station: 'Station 1',
          session: {
            ...openingSession,
            workflow_state: 'idle',
          },
          motor_dispatch: {
            workflow_action: 'finish_open',
            outcome: 'rejected',
            serial_command_sent: false,
            serial_connection: 'disconnected',
            physical_movement_verified: false,
            error: 'Motor actuation is disabled; no serial command was sent.',
          },
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://127.0.0.1:5001/api/scans')) {
        const after = Number(new URL(requestUrl).searchParams.get('after'))
        return new Response(JSON.stringify({ events: [], next_cursor: after, has_more: false }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /open cabinet/i }))
    await user.click(screen.getByText('STATION 1').closest('button'))
    await user.click(screen.getByRole('button', { name: 'CONTINUE' }))
    await user.click(screen.getByRole('button', { name: 'OPEN CABINET' }))

    expect(await screen.findByRole('heading', { name: 'Open Workflow Complete' })).toBeTruthy()
    expect(screen.getByText(/Open workflow completed for Station 1\. Motor dispatch disabled\. Motor actuation is disabled; no serial command was sent\./i)).toBeTruthy()
  })

  it('routes recovery through the active Pi bridge and displays only backend-confirmed status', async () => {
    const recoveryRequestId = 'opaque-request-id'
    const fetcher = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://127.0.0.1:5001/cabinet/workflow') {
        return new Response(JSON.stringify({
          mode: 'hardware',
          cabinet_name: 'Cabinet 1',
          stations: [
            { name: 'Station 1', status: 'available', session: null },
            { name: 'Station 2', status: 'available', session: null },
          ],
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://127.0.0.1:5001/api/scans')) {
        const after = Number(new URL(requestUrl).searchParams.get('after'))
        return new Response(JSON.stringify({ events: [], next_cursor: after, has_more: false }), { status: 200 })
      }
      if (requestUrl === 'http://127.0.0.1:5001/password-reset/handoff') {
        expect(JSON.parse(options.body)).toEqual({ request_id: recoveryRequestId })
        return new Response(JSON.stringify({
          request_id: recoveryRequestId,
          state: 'waiting',
          message: 'Request accepted. Tap the NFC card linked to this account.',
          expires_at: '2026-10-24T12:00:00Z',
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://127.0.0.1:5001/password-reset/bridge-status')) {
        return new Response(JSON.stringify({
          request_id: recoveryRequestId,
          active: false,
          state: 'verified',
          message: 'The backend confirmed NFC recovery verification.',
        }), { status: 200 })
      }
      if (requestUrl === '/api/auth/password-reset/status/') {
        expect(JSON.parse(options.body)).toEqual({ request_id: recoveryRequestId })
        expect(options.credentials).toBe('same-origin')
        return new Response(JSON.stringify({
          request_id: recoveryRequestId,
          status: 'verified',
          reset_authorization: 'never-render-this-authorization',
        }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /password recovery/i }))
    await user.type(screen.getByLabelText('Password-reset request ID'), recoveryRequestId)
    await user.click(screen.getByRole('button', { name: 'START NFC RECOVERY' }))

    expect(await screen.findByText('Django confirmed password-recovery status: verified.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('never-render-this-authorization')
    expect(fetcher.mock.calls.some(([url, options]) => (
      String(url) === 'http://127.0.0.1:5001/cabinet/workflow' && options.method === 'POST'
    ))).toBe(false)
    expect(fetcher.mock.calls.some(([url]) => String(url) === 'http://127.0.0.1:5001/password-reset/handoff')).toBe(true)
  })

  it('shows a wrong-card response from the recovery reader without processing it as an access scan', async () => {
    const recoveryRequestId = 'opaque-wrong-card'
    const fetcher = vi.fn(async (url) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://127.0.0.1:5001/cabinet/workflow') {
        return new Response(JSON.stringify({
          mode: 'hardware',
          cabinet_name: 'Cabinet 1',
          stations: [{ name: 'Station 1', status: 'available', session: null }],
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://127.0.0.1:5001/api/scans')) {
        const after = Number(new URL(requestUrl).searchParams.get('after'))
        return new Response(JSON.stringify({ events: [], next_cursor: after, has_more: false }), { status: 200 })
      }
      if (requestUrl === 'http://127.0.0.1:5001/password-reset/handoff') {
        return new Response(JSON.stringify({
          request_id: recoveryRequestId,
          state: 'waiting',
          message: 'Tap the card linked to this account.',
          expires_at: '2026-10-24T12:00:00Z',
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://127.0.0.1:5001/password-reset/bridge-status')) {
        return new Response(JSON.stringify({
          request_id: recoveryRequestId,
          state: 'failed',
          message: 'This card does not match the password-reset request.',
        }), { status: 200 })
      }
      if (requestUrl === '/api/auth/password-reset/status/') {
        return new Response(JSON.stringify({ request_id: recoveryRequestId, status: 'pending' }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /password recovery/i }))
    await user.type(screen.getByLabelText('Password-reset request ID'), recoveryRequestId)
    await user.click(screen.getByRole('button', { name: 'START NFC RECOVERY' }))

    expect(await screen.findByText('This card does not match the password-reset request.')).toBeTruthy()
    expect(fetcher.mock.calls.some(([url, options]) => (
      String(url).startsWith('http://127.0.0.1:5001/api/scans') && options.method === 'POST'
    ))).toBe(false)
  })

  it('shows uncertain serial transmission details without implying no command was sent', async () => {
    const openingSession = {
      id: 24,
      station: 'Station 1',
      status: 'open',
      workflow_state: 'opening',
      opened_by: [{ uid: 'REAL-BRIDGE-UID', studentId: 'HW-001', fullName: 'Hardware Test Student' }],
      closed_by: [],
    }
    const fetcher = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://127.0.0.1:5001/cabinet/workflow') {
        if (options.method === 'GET') {
          return new Response(JSON.stringify({
            mode: 'hardware',
            cabinet_name: 'Cabinet 1',
            stations: [
              { name: 'Station 1', status: 'occupied', session: openingSession },
              { name: 'Station 2', status: 'available', session: null },
            ],
          }), { status: 200 })
        }
        return new Response(JSON.stringify({
          mode: 'hardware',
          station: 'Station 1',
          session: { ...openingSession, workflow_state: 'idle' },
          motor_dispatch: {
            workflow_action: 'finish_open',
            outcome: 'uncertain',
            serial_command_sent: null,
            serial_connection: 'connected',
            physical_movement_verified: false,
            error: 'Serial write failed; transmission status is unknown.',
          },
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://127.0.0.1:5001/api/scans')) {
        const after = Number(new URL(requestUrl).searchParams.get('after'))
        return new Response(JSON.stringify({ events: [], next_cursor: after, has_more: false }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /open cabinet/i }))
    await user.click(screen.getByText('STATION 1').closest('button'))
    await user.click(screen.getByRole('button', { name: 'CONTINUE' }))
    await user.click(screen.getByRole('button', { name: 'OPEN CABINET' }))

    expect(await screen.findByRole('heading', { name: 'Open Workflow Complete' })).toBeTruthy()
    expect(screen.getByText(/could not determine whether a serial command was sent\. Manual inspection is required\. Serial write failed/i)).toBeTruthy()
  })
})