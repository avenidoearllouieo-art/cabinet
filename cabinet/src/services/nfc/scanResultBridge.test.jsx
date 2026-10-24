import { describe, expect, it } from 'vitest'
import { fetchCabinetWorkflow, fetchNfcServiceStatus, fetchScanEvents, sendCabinetWorkflow } from './scanResultBridge.js'

describe('Cabinet workflow status requests', () => {
  it('uses the API proxy and mock-mode header for a mock GET', async () => {
    let request
    const result = await fetchCabinetWorkflow({
      mode: 'mock',
      fetcher: async (url, options) => {
        request = { url, options }
        return new Response(JSON.stringify({ mode: 'mock', stations: [] }), { status: 200 })
      },
    })

    expect(request.url).toBe('/api/cabinet/workflow/')
    expect(request.options.method).toBe('GET')
    expect(request.options.headers['X-TapTrack-Mock-Mode']).toBe('true')
    expect(request.options.body).toBeUndefined()
    expect(result.mode).toBe('mock')
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

  it('identifies a missing Django proxy for explicit mock workflow reads', async () => {
    await expect(fetchCabinetWorkflow({
      mode: 'mock',
      fetcher: async () => { throw new TypeError('Failed to fetch') },
    })).rejects.toThrow('Cabinet API unavailable. Check Django and the development proxy.')
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
})