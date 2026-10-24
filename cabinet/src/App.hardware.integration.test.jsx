import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'

vi.mock('./services/nfc/nfcMode', () => ({
  resolveNfcMode: () => 'hardware',
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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
            session: { id: 21, station, status: 'open', workflow_state: 'opening', opened_by: [] },
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
    expect(screen.getByText(/physical shutter movement was not verified/i)).toBeTruthy()
  })
})