import { describe, expect, it } from 'vitest'
import { fetchCabinetWorkflow } from './scanResultBridge.js'

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
})