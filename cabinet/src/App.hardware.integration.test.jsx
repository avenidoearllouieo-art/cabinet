import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'
import { motorDispatchStatus } from './utils/motorDispatchStatus.js'

const djangoPasswordResetStatusUrl = `${(import.meta.env.VITE_DJANGO_API_BASE_URL || '/api').replace(/\/$/, '')}/auth/password-reset/status/`

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

  it('distinguishes disabled, not-sent, busy, failed, dispatched, and unknown outcomes', () => {
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
      serial_command_completed: true,
      physical_movement_verified: false,
    }, 'finish_open')).toMatch(/ESP32 completed its command sequence; physical shutter movement was not verified/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_open',
      outcome: 'uncertain',
      serial_command_sent: true,
      serial_accepted: true,
      serial_connection: 'connected',
      controller_armed: true,
    }, 'finish_open')).toMatch(/ESP32 accepted the command, but completion is unconfirmed/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_close',
      outcome: 'uncertain',
      serial_command_sent: null,
    }, 'finish_close')).toMatch(/Motor outcome unknown/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_open',
      outcome: 'busy',
      serial_command_sent: false,
    }, 'finish_open')).toMatch(/busy; no serial command was sent/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_close',
      outcome: 'busy',
      serial_command_sent: true,
    }, 'finish_close')).toMatch(/transmitted command was rejected before execution/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_open',
      outcome: 'uncertain',
      serial_command_sent: false,
      error: 'Controller is disarmed.',
    }, 'finish_open')).toMatch(/command was not transmitted/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_close',
      outcome: 'uncertain',
      serial_command_sent: false,
      controller_armed: false,
      serial_connection: 'disconnected',
      error: 'Operator recovery is required.',
    }, 'finish_close')).toMatch(/controller is disarmed.*serial connection is disconnected.*operator recovery is required/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_open',
      outcome: 'rejected',
      serial_command_sent: false,
      controller_armed: false,
      serial_connection: 'disconnected',
      error: 'Motor actuation is disabled; no serial command was sent.',
    }, 'finish_open')).toMatch(/dispatch disabled.*no serial command was sent.*serial connection: disconnected.*controller disarmed/i)
    expect(motorDispatchStatus({
      workflow_action: 'finish_close',
      outcome: 'rejected',
      serial_command_sent: true,
      error: 'BAD_COMMAND',
    }, 'finish_close')).toMatch(/Motor dispatch failed/i)
  })
})

describe('Cabinet real NFC bridge mode', () => {
  it('loads stations after the bridge comes online without a workflow write', async () => {
    let reads = 0
    const fetcher = vi.fn(async (url) => {
      const requestUrl = new URL(String(url))
      if (requestUrl.pathname.endsWith('/cabinet/workflow')) {
        reads += 1
        if (reads === 1) return new Response('{}', { status: 503 })
        return new Response(JSON.stringify({
          mode: 'hardware', stations: [{ name: 'Station 1', status: 'available', session: null }],
        }))
      }
      return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }))
    })
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    expect(await screen.findByText(/Station status unavailable/)).toBeTruthy()
    expect(await screen.findByText('STATION 1', {}, { timeout: 3000 })).toBeTruthy()
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('ignores a replayed enrolled card when starting a new group', async () => {
    let scanning = false
    let replayed = false
    let tapped = false
    const scan = { event_id: 49, status: 'registered', uid: 'OLD-CARD', name: 'Historical Student',
      student_id: 'OLD-49', role: 'student', django_response: { event_id: 4001 } }
    const fetcher = vi.fn(async (url, options) => {
      const requestUrl = new URL(String(url))
      let payload
      if (requestUrl.pathname.endsWith('/cabinet/workflow')) {
        if (options.method === 'POST') {
          scanning = true
          payload = { mode: 'hardware', station: 'Station 1',
            session: { id: 1, station: 'Station 1', status: 'open', workflow_state: 'opening', opened_by: [], closed_by: [] } }
        } else {
          payload = { mode: 'hardware', stations: [{ name: 'Station 1', status: 'available', session: null }] }
        }
      } else {
        const sendReplay = scanning && requestUrl.searchParams.get('after') === '49'
        replayed ||= sendReplay
        payload = {
          events: sendReplay
            ? [scan, ...(tapped ? [{ ...scan, event_id: 50, uid: 'NEW-CARD', name: 'Fresh Student', student_id: 'NEW-50' }] : [])]
            : [],
          next_cursor: tapped ? 50 : 49, has_more: false,
        }
      }
      return new Response(JSON.stringify(payload))
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /open cabinet/i }))
    await user.click((await screen.findByText('STATION 1')).closest('button'))
    await waitFor(() => expect(replayed).toBe(true), { timeout: 3000 })
    expect(screen.queryByText('Historical Student')).toBeNull()
    expect(screen.getByText('Participants scanned: 0')).toBeTruthy()
    tapped = true
    expect(await screen.findByText('Participants scanned: 1', {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.queryByText('Historical Student')).toBeNull()
    expect(screen.getAllByText('Fresh Student').length).toBeGreaterThan(0)
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/photo/capture'))).toBe(false)
  })

  it('shows bridge unavailability and never renders mock UID controls', async () => {
    const fetcher = vi.fn(async (url) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
        return new Response(JSON.stringify({
          mode: 'hardware',
          cabinet_name: 'Cabinet 1',
          stations: [
            { name: 'Station 1', status: 'available', session: null },
            { name: 'Station 2', status: 'available', session: null },
          ],
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        throw new TypeError('Failed to fetch')
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)

    render(<App />)

    await waitFor(() => expect(screen.getByText('NFC Disconnected')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
    await userEvent.setup().click(screen.getByText('Technical details'))
    expect(screen.getByText('NFC bridge unavailable. Check the NFC service connection.')).toBeTruthy()
    expect(screen.queryByLabelText('Mock NFC UID')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use Pi mock reader' })).toBeNull()
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3000/nfc-bridge/cabinet/workflow',
      expect.objectContaining({ method: 'GET' }),
    )
    const workflowRequest = fetcher.mock.calls.find(([url]) => String(url).endsWith('/cabinet/workflow'))
    expect(workflowRequest?.[1]?.headers?.['X-API-Key']).toBeUndefined()
    expect(screen.queryByText('The mock NFC service could not verify the card.')).toBeNull()
    await waitFor(() => expect(fetcher.mock.calls.some(([url, options]) => (
      String(url).startsWith('http://localhost:3000/nfc-bridge/api/scans') && options.method === 'GET'
    ))).toBe(true))
  })

  it('does not imply station availability when workflow state is unavailable', async () => {
    const fetcher = vi.fn(async (url) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
        throw new TypeError('Failed to fetch')
      }
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        const params = new URL(requestUrl).searchParams
        if (params.has('tail')) {
          return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }), { status: 200 })
        }
        const after = Number(params.get('after'))
        return new Response(JSON.stringify({ events: [], next_cursor: after, has_more: false }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)

    render(<App />)

    expect(await screen.findByText('Station status unavailable. Check the NFC bridge connection.')).toBeTruthy()
    expect(screen.queryByText('Ready for access')).toBeNull()
  })

  it('shows actual station and controller state without claiming unreported physical position', async () => {
    const activeSession = {
      id: 32,
      station: 'Station 1',
      status: 'open',
      workflow_state: 'idle',
      opened_by: [
        { uid: 'UID-1', studentId: 'STU-001', fullName: 'First Student' },
        { uid: 'UID-2', studentId: 'STU-002', fullName: 'Second Student' },
      ],
      closed_by: [],
      opened_at: '2026-11-23T01:00:00Z',
    }
    const fetcher = vi.fn(async (url) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
        return new Response(JSON.stringify({
          mode: 'hardware',
          cabinet_name: 'Cabinet 1',
          stations: [
            { name: 'Station 1', status: 'occupied', session: activeSession },
            { name: 'Station 2', status: 'available', session: null },
          ],
        }), { status: 200 })
      }
      if (requestUrl === 'http://localhost:3000/nfc-bridge/nfc/status') {
        return new Response(JSON.stringify({
          service: 'ready',
          reader_connected: true,
          motor: {
            mode: 'serial',
            actuation_enabled: false,
            serial_connection: 'disconnected',
            armed: false,
          },
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        const params = new URL(requestUrl).searchParams
        if (params.has('tail')) {
          return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }), { status: 200 })
        }
        const after = Number(params.get('after'))
        return new Response(JSON.stringify({ events: [], next_cursor: after, has_more: false }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /CABINET STATUS/i }))

    expect(await screen.findByText('Motor actuation: Disabled')).toBeTruthy()
    expect(screen.getByText('Physical cabinet position: Not reported by controller')).toBeTruthy()
    expect(screen.getByText('Motor controller: Serial controller')).toBeTruthy()
    expect(screen.getByText('Controller connection: disconnected')).toBeTruthy()
    expect(screen.getByText('Occupied')).toBeTruthy()
    expect(screen.getByText('Available')).toBeTruthy()
    expect(screen.getByText(/2 participants · opened/)).toBeTruthy()
    expect(screen.getByText('No active session')).toBeTruthy()
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3000/nfc-bridge/nfc/status',
      expect.objectContaining({ method: 'GET' }),
    )
  })
  it('does not show open workflow success when Django rejects the final transition', async () => {
    let scanPolls = 0
    const fetcher = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
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
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        scanPolls += 1
        const events = scanPolls < 2 ? [] : [{
          event_id: 1,
          uid: 'REAL-BRIDGE-UID',
          status: 'registered',
          name: 'Hardware Test Student',
          student_id: 'HW-001',
          role: 'student',
        }]
        const params = new URL(requestUrl).searchParams
        if (params.has('tail')) {
          return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }), { status: 200 })
        }
        const after = Number(params.get('after'))
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
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
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
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        const params = new URL(requestUrl).searchParams
        if (params.has('tail')) {
          return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }), { status: 200 })
        }
        const after = Number(params.get('after'))
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
    expect(screen.getByText(/ESP32 completed its command sequence; physical shutter movement was not verified/i)).toBeTruthy()
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
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
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
            serial_accepted: false,
            serial_command_completed: false,
            controller_armed: false,
            serial_connection: 'disconnected',
            physical_movement_verified: false,
            error: 'Motor actuation is disabled; no serial command was sent.',
          },
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        const params = new URL(requestUrl).searchParams
        if (params.has('tail')) {
          return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }), { status: 200 })
        }
        const after = Number(params.get('after'))
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
    expect(screen.getByText('Open workflow completed for Station 1.')).toBeTruthy()
    expect(screen.getByText(/Motor dispatch disabled; no serial command was sent\. Serial connection: disconnected\. Controller disarmed\. Motor actuation is disabled/i)).toBeTruthy()
  })

  it('routes the authorized Close workflow through finish_close and reports disabled dispatch', async () => {
    const openingMember = {
      uid: 'CLOSE-MEMBER-UID',
      studentId: 'HW-001',
      fullName: 'Hardware Test Student',
    }
    const activeSession = {
      id: 25,
      station: 'Station 1',
      status: 'open',
      workflow_state: 'idle',
      opened_by: [openingMember],
      closed_by: [],
    }
    let closeWorkflowStarted = false
    let memberScanned = false
    const fetcher = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
        if (options.method === 'GET') {
          return new Response(JSON.stringify({
            mode: 'hardware',
            cabinet_name: 'Cabinet 1',
            stations: [
              { name: 'Station 1', status: 'occupied', session: activeSession },
              { name: 'Station 2', status: 'available', session: null },
            ],
          }), { status: 200 })
        }
        const request = JSON.parse(options.body)
        if (request.command === 'start_close') {
          closeWorkflowStarted = true
          return new Response(JSON.stringify({
            mode: 'hardware',
            station: request.station,
            session: { ...activeSession, workflow_state: 'closing' },
          }), { status: 200 })
        }
        if (request.command === 'finish_close') {
          expect(request).toEqual({ command: 'finish_close', station: 'Station 1' })
          return new Response(JSON.stringify({
            mode: 'hardware',
            station: request.station,
            session: {
              ...activeSession,
              status: 'closed',
              workflow_state: 'idle',
              closed_by: [openingMember],
            },
            motor_dispatch: {
              workflow_action: 'finish_close',
              outcome: 'rejected',
              serial_command_sent: false,
              serial_accepted: false,
              serial_command_completed: false,
              controller_armed: false,
              serial_connection: 'disconnected',
              physical_movement_verified: false,
              error: 'Motor actuation is disabled; no serial command was sent.',
            },
          }), { status: 200 })
        }
        throw new Error(`Unexpected workflow command: ${request.command}`)
      }
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        const params = new URL(requestUrl).searchParams
        if (params.has('tail')) {
          return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }), { status: 200 })
        }
        const after = Number(params.get('after'))
        const events = closeWorkflowStarted && !memberScanned ? [{
          event_id: 2,
          uid: openingMember.uid,
          status: 'registered',
          name: openingMember.fullName,
          student_id: openingMember.studentId,
          role: 'student',
        }] : []
        if (events.length) memberScanned = true
        return new Response(JSON.stringify({
          events,
          next_cursor: events.length ? 2 : after,
          has_more: false,
        }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /close cabinet/i }))
    await user.click(await screen.findByRole('button', { name: 'CLOSE STATION 1' }))
    await screen.findAllByText('Hardware Test Student')
    await user.click(await screen.findByRole('button', { name: 'CLOSE CABINET' }))
    await user.click(await screen.findByRole('button', { name: 'CLOSE STATION 1' }))

    expect(await screen.findByRole('heading', { name: 'Close Workflow Complete' })).toBeTruthy()
    expect(screen.getByText(/Motor dispatch disabled; no serial command was sent\. Serial connection: disconnected\. Controller disarmed/i)).toBeTruthy()
    expect(screen.getByText('Physical shutter movement was not verified.')).toBeTruthy()
    expect(fetcher.mock.calls.some(([url, options]) => (
      String(url) === 'http://localhost:3000/nfc-bridge/cabinet/workflow'
      && options.method === 'POST'
      && JSON.stringify(JSON.parse(options.body)) === JSON.stringify({ command: 'finish_close', station: 'Station 1' })
    ))).toBe(true)
  })

  it('shows transient NFC verification success, then returns to the refreshed request list', async () => {
    const recoveryRequestId = 'opaque-request-id'
    let recoveryCompleted = false
    const fetcher = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
        return new Response(JSON.stringify({
          mode: 'hardware',
          cabinet_name: 'Cabinet 1',
          stations: [
            { name: 'Station 1', status: 'available', session: null },
            { name: 'Station 2', status: 'available', session: null },
          ],
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        const params = new URL(requestUrl).searchParams
        if (params.has('tail')) {
          return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }), { status: 200 })
        }
        const after = Number(params.get('after'))
        return new Response(JSON.stringify({ events: [], next_cursor: after, has_more: false }), { status: 200 })
      }
      if (requestUrl === 'http://localhost:3000/nfc-bridge/password-reset/queue') {
        return new Response(JSON.stringify({
          count: recoveryCompleted ? 0 : 1,
          results: recoveryCompleted ? [] : [
            { request_id: recoveryRequestId, display_name: 'Student A', account_reference: '•••-001', status: 'pending' },
          ],
        }), { status: 200 })
      }
      if (requestUrl === 'http://localhost:3000/nfc-bridge/password-reset/handoff') {
        expect(JSON.parse(options.body)).toEqual({ request_id: recoveryRequestId })
        return new Response(JSON.stringify({
          request_id: recoveryRequestId,
          state: 'waiting',
          message: 'Request accepted. Tap the NFC card linked to this account.',
          expires_at: '2026-10-26T12:00:00Z',
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/password-reset/bridge-status')) {
        return new Response(JSON.stringify({
          request_id: recoveryRequestId,
          active: false,
          state: 'verified',
          message: 'The backend confirmed NFC recovery verification.',
        }), { status: 200 })
      }
      if (requestUrl === djangoPasswordResetStatusUrl) {
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
    await user.click(await screen.findByRole('button', { name: /Student A.*•••-001.*pending/i }))
    expect(screen.queryByLabelText(/Password-reset request ID/i)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'START NFC RECOVERY' }))

    expect(await screen.findByText('Identity verified. You can now create a new password on the TapTrack website.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('never-render-this-authorization')
    recoveryCompleted = true
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Student A.*•••-001.*pending/i })).toBeNull()
    }, { timeout: 5000 })
    await waitFor(() => {
      expect(screen.queryByText('Identity verified. You can now create a new password on the TapTrack website.')).toBeNull()
      expect(screen.getByText('No pending recovery requests.')).toBeTruthy()
      expect(screen.getByText('New requests appear here automatically.')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'START NFC RECOVERY' }).disabled).toBe(true)
    }, { timeout: 5500 })
    expect(fetcher.mock.calls.some(([url]) => String(url) === 'http://localhost:3000/nfc-bridge/password-reset/cancel')).toBe(false)
    expect(fetcher.mock.calls.filter(([url]) => (
      String(url) === 'http://localhost:3000/nfc-bridge/password-reset/queue'
    )).length).toBeGreaterThan(1)
    expect(screen.getByRole('heading', { name: 'Password Recovery' })).toBeTruthy()
    expect(fetcher.mock.calls.some(([url, options]) => (
      String(url) === 'http://localhost:3000/nfc-bridge/cabinet/workflow' && options.method === 'POST'
    ))).toBe(false)
    expect(fetcher.mock.calls.some(([url]) => String(url) === 'http://localhost:3000/nfc-bridge/password-reset/handoff')).toBe(true)
  }, 10000)

  it('shows a wrong-card response from the recovery reader without processing it as an access scan', async () => {
    const recoveryRequestId = 'opaque-wrong-card'
    const fetcher = vi.fn(async (url) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
        return new Response(JSON.stringify({
          mode: 'hardware',
          cabinet_name: 'Cabinet 1',
          stations: [{ name: 'Station 1', status: 'available', session: null }],
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        const params = new URL(requestUrl).searchParams
        if (params.has('tail')) {
          return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }), { status: 200 })
        }
        const after = Number(params.get('after'))
        return new Response(JSON.stringify({ events: [], next_cursor: after, has_more: false }), { status: 200 })
      }
      if (requestUrl === 'http://localhost:3000/nfc-bridge/password-reset/queue') {
        return new Response(JSON.stringify({
          count: 1,
          results: [{ request_id: recoveryRequestId, display_name: 'Student B', account_reference: '•••-002', status: 'pending' }],
        }), { status: 200 })
      }
      if (requestUrl === 'http://localhost:3000/nfc-bridge/password-reset/handoff') {
        return new Response(JSON.stringify({
          request_id: recoveryRequestId,
          state: 'waiting',
          message: 'Tap the card linked to this account.',
          expires_at: '2026-10-26T12:00:00Z',
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/password-reset/bridge-status')) {
        return new Response(JSON.stringify({
          request_id: recoveryRequestId,
          state: 'failed',
          message: 'This card does not match the password-reset request.',
        }), { status: 200 })
      }
      if (requestUrl === djangoPasswordResetStatusUrl) {
        return new Response(JSON.stringify({ request_id: recoveryRequestId, status: 'pending' }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /password recovery/i }))
    await user.click(await screen.findByRole('button', { name: /Student B.*•••-002.*pending/i }))
    expect(screen.queryByLabelText(/Password-reset request ID/i)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'START NFC RECOVERY' }))

    expect(await screen.findByText('This card does not match the password-reset request.')).toBeTruthy()
    expect(fetcher.mock.calls.some(([url, options]) => (
      String(url).startsWith('http://localhost:3000/nfc-bridge/api/scans') && options.method === 'POST'
    ))).toBe(false)
  })

  it('shows a retryable recovery queue error and recovers on retry', async () => {
    let queueAttempts = 0
    const fetcher = vi.fn(async (url) => {
      const requestUrl = String(url)
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
        return new Response(JSON.stringify({
          mode: 'hardware',
          cabinet_name: 'Cabinet 1',
          stations: [{ name: 'Station 1', status: 'available', session: null }],
        }), { status: 200 })
      }
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        const params = new URL(requestUrl).searchParams
        if (params.has('tail')) {
          return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }), { status: 200 })
        }
        const after = Number(params.get('after'))
        return new Response(JSON.stringify({ events: [], next_cursor: after, has_more: false }), { status: 200 })
      }
      if (requestUrl === 'http://localhost:3000/nfc-bridge/password-reset/queue') {
        queueAttempts += 1
        if (queueAttempts === 1) {
          return new Response(JSON.stringify({ error: 'Queue temporarily unavailable.' }), { status: 503 })
        }
        return new Response(JSON.stringify({
          count: 1,
          results: [{ request_id: 'retry-request', display_name: 'Retry Student', account_reference: '•••-003', status: 'pending' }],
        }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /password recovery/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('Queue temporarily unavailable.')
    await user.click(screen.getByRole('button', { name: 'RETRY' }))
    await user.click(await screen.findByRole('button', { name: /Retry Student.*•••-003.*pending/i }))
    expect(screen.getByRole('button', { name: 'START NFC RECOVERY' }).disabled).toBe(false)
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
      if (requestUrl === 'http://localhost:3000/nfc-bridge/cabinet/workflow') {
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
      if (requestUrl.startsWith('http://localhost:3000/nfc-bridge/api/scans')) {
        const params = new URL(requestUrl).searchParams
        if (params.has('tail')) {
          return new Response(JSON.stringify({ events: [], next_cursor: 0, has_more: false }), { status: 200 })
        }
        const after = Number(params.get('after'))
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