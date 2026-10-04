const DEFAULT_SCAN_BRIDGE_URL = 'http://127.0.0.1:5001/api/scans'

const scanBridgeUrl = (import.meta.env.VITE_NFC_BRIDGE_URL || DEFAULT_SCAN_BRIDGE_URL).replace(/\/$/, '')
const workflowUrl = `${new URL(scanBridgeUrl).origin}/cabinet/workflow`

async function requestWorkflow(command, { signal, fetcher = fetch, mode = 'hardware', station } = {}) {
  const mockMode = mode === 'mock'
  const url = mockMode ? '/api/cabinet/workflow/' : workflowUrl
  const body = command ? { command } : null
  if (body && mockMode && station) body.station = station
  const response = await fetcher(url, {
    method: command ? 'POST' : 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(mockMode ? { 'X-TapTrack-Mock-Mode': 'true' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    signal,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Cabinet workflow returned HTTP ${response.status}.`)
  return payload
}

export function fetchCabinetWorkflow(options) {
  return requestWorkflow(null, options)
}

export function sendCabinetWorkflow(command, options) {
  return requestWorkflow(command, options)
}

export async function fetchScanEvents(after, { signal, fetcher = fetch } = {}) {
  const url = new URL(scanBridgeUrl)
  url.searchParams.set('after', String(after))
  url.searchParams.set('limit', '50')

  let response
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('NFC reader unavailable. Retrying connection.', { cause: error })
  }

  if (!response.ok) {
    throw new Error(`NFC scan bridge returned HTTP ${response.status}.`)
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('NFC scan bridge returned malformed JSON.')
  }

  if (
    !payload
    || !Array.isArray(payload.events)
    || !Number.isSafeInteger(payload.next_cursor)
    || typeof payload.has_more !== 'boolean'
  ) {
    throw new Error('NFC scan bridge returned an invalid response.')
  }

  return {
    ...payload,
    events: [...payload.events].sort((left, right) => Number(left.event_id) - Number(right.event_id)),
  }
}