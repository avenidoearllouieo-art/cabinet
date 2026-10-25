import { describe, expect, it } from 'vitest'
import {
  cancelPasswordRecovery,
  fetchCabinetWorkflow,
  fetchNfcServiceStatus,
  fetchPasswordRecoveryBridgeStatus,
  fetchPasswordRecoveryStatus,
  fetchScanEvents,
  sendCabinetWorkflow,
  startPasswordRecovery,
} from './scanResultBridge.js'

const djangoPasswordResetStatusUrl = `${(import.meta.env.VITE_DJANGO_API_BASE_URL || '/api').replace(/\/$/, '')}/auth/password-reset/status/`

describe('Cabinet workflow status requests', () => {
  it('uses the real NFC bridge for workflow reads without mock headers', async () => {
    let request
    const result = await fetchCabinetWorkflow({
      fetcher: async (url, options) => {
        request = { url, options }
        return new Response(JSON.stringify({ mode: 'hardware', stations: [] }), { status: 200 })
      },
    })

    expect(request.url).toBe('http://127.0.0.1:5001/cabinet/workflow')
    expect(request.options.method).toBe('GET')
    expect(request.options.headers['X-TapTrack-Mock-Mode']).toBeUndefined()
    expect(request.options.body).toBeUndefined()
    expect(result.mode).toBe('hardware')
  })

  it('keeps hardware status reads on the bridge without a mock header', async () => {
    let request
    await fetchCabinetWorkflow({
      mode: 'hardware',
      fetcher: async (url, options) => {
        request = { url: String(url), options }
        return new Response(JSON.stringify({ mode: 'hardware', stations: [] }), { status: 200 })
      },
    })

    expect(request.url).toBe('http://127.0.0.1:5001/cabinet/workflow')
    expect(request.options.method).toBe('GET')
    expect(request.options.headers['X-TapTrack-Mock-Mode']).toBeUndefined()
    expect(request.options.body).toBeUndefined()
  })

  it('reports bridge network failures as retryable reader-unavailable errors', async () => {
    await expect(fetchScanEvents(0, {
      fetcher: async () => { throw new TypeError('Failed to fetch') },
    })).rejects.toThrow('NFC bridge unavailable. Check the NFC service connection.')
  })

  it('identifies a missing hardware bridge for workflow status reads', async () => {
    await expect(fetchCabinetWorkflow({
      mode: 'hardware',
      fetcher: async () => { throw new TypeError('Failed to fetch') },
    })).rejects.toThrow('NFC bridge unavailable. Check the NFC service connection.')
  })

  it('reports failed backend workflow requests instead of returning simulated data', async () => {
    await expect(fetchCabinetWorkflow({
      fetcher: async () => { throw new TypeError('Failed to fetch') },
    })).rejects.toThrow('NFC bridge unavailable. Check the NFC service connection.')
  })

  it('rejects malformed station data before returning the workflow state', async () => {
    await expect(fetchCabinetWorkflow({
      fetcher: async () => new Response(JSON.stringify({
        mode: 'hardware',
        stations: [{ name: '', status: 'available', session: null }],
      }), { status: 200 }),
    })).rejects.toThrow('Cabinet workflow returned an invalid response.')
  })

  it('reads the NFC bridge status endpoint without using the legacy mock service', async () => {
    let request
    const status = await fetchNfcServiceStatus({
      fetcher: async (url, options) => {
        request = { url: String(url), options }
        return new Response(JSON.stringify({ service: 'ready', reader_connected: true, state: 'waiting' }), { status: 200 })
      },
    })

    expect(request.url).toBe('http://127.0.0.1:5001/nfc/status')
    expect(request.options.method).toBe('GET')
    expect(status.reader_connected).toBe(true)
  })

  it('rejects malformed or non-final backend workflow success payloads', async () => {
    for (const payload of [
      { mode: 'hardware', station: 'Station 1', session: null },
      {
        mode: 'hardware',
        station: 'Station 1',
        session: { id: 3, station: 'Station 1', status: 'open', workflow_state: 'opening' },
      },
    ]) {
      await expect(sendCabinetWorkflow('finish_open', {
        mode: 'hardware',
        station: 'Station 1',
        fetcher: async () => new Response(JSON.stringify(payload), { status: 200 }),
      })).rejects.toThrow(/invalid session response|did not confirm/i)
    }
  })

  it('starts and cancels opaque password recovery requests through the loopback bridge', async () => {
    const calls = []
    const fetcher = async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify(
        options.method === 'POST' && String(url).endsWith('/handoff')
          ? {
            request_id: 'opaque-id',
            state: 'waiting',
            message: 'Tap the registered card.',
            expires_at: '2026-10-24T12:00:00Z',
          }
          : { cancelled: true },
      ), { status: 200 })
    }

    await startPasswordRecovery('opaque-id', { fetcher })
    await cancelPasswordRecovery('opaque-id', { fetcher })

    expect(calls[0].url).toBe('http://127.0.0.1:5001/password-reset/handoff')
    expect(JSON.parse(calls[0].options.body)).toEqual({ request_id: 'opaque-id' })
    expect(calls[1].url).toBe('http://127.0.0.1:5001/password-reset/cancel')
    expect(JSON.parse(calls[1].options.body)).toEqual({ request_id: 'opaque-id' })
    await expect(startPasswordRecovery('')).rejects.toThrow('Enter a valid password-reset request ID.')
  })

  it('identifies an unrecognized Pi handoff route without masking unavailable request IDs', async () => {
    await expect(startPasswordRecovery('opaque-id', {
      fetcher: async () => new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 }),
    })).rejects.toThrow(/Pi NFC service does not recognize the password-recovery handoff route/i)

    await expect(startPasswordRecovery('opaque-id', {
      fetcher: async () => new Response(JSON.stringify({
        error: 'This recovery request is unavailable on the configured Django server.',
      }), { status: 404 }),
    })).rejects.toThrow(/recovery request is unavailable on the configured Django server/i)
  })

  it('polls Django recovery status separately and rejects malformed responses', async () => {
    const requests = []
    const status = await fetchPasswordRecoveryStatus('opaque-id', {
      fetcher: async (url, options) => {
        requests.push({ url: String(url), options })
        return new Response(JSON.stringify({
          request_id: 'opaque-id',
          status: 'verified',
          reset_authorization: 'never-render-this-authorization',
        }), { status: 200 })
      },
    })
    expect(requests[0].url).toBe(djangoPasswordResetStatusUrl)
    expect(requests[0].options.credentials).toBe('same-origin')
    expect(JSON.parse(requests[0].options.body)).toEqual({ request_id: 'opaque-id' })
    expect(status.status).toBe('verified')

    await expect(fetchPasswordRecoveryStatus('opaque-id', {
      fetcher: async () => new Response(JSON.stringify({
        request_id: 'opaque-id',
        status: 'verified',
      }), { status: 200 }),
    })).rejects.toThrow('Password-reset status returned an invalid verification response.')

    await expect(fetchPasswordRecoveryStatus('opaque-id', {
      fetcher: async () => new Response('not-json', { status: 200 }),
    })).rejects.toThrow('Password-reset status returned malformed JSON.')
    await expect(fetchPasswordRecoveryBridgeStatus('opaque-id', {
      fetcher: async () => new Response(JSON.stringify({ request_id: 'different', state: 'waiting', message: 'wait' }), { status: 200 }),
    })).rejects.toThrow('Password-recovery bridge returned an invalid status response.')
  })
})