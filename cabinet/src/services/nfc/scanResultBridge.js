const DEFAULT_SCAN_BRIDGE_URL = 'http://127.0.0.1:5001/api/scans'

const scanBridgeUrl = (import.meta.env.VITE_NFC_BRIDGE_URL || DEFAULT_SCAN_BRIDGE_URL).replace(/\/$/, '')
const bridgeOrigin = new URL(scanBridgeUrl).origin
const workflowUrl = `${bridgeOrigin}/cabinet/workflow`

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateWorkflowResponse(payload, command, station, expectedMode) {
  if (!isRecord(payload) || payload.mode !== expectedMode) {
    throw new Error('Cabinet workflow returned an invalid response.')
  }
  if (!command) {
    if (!Array.isArray(payload.stations)) throw new Error('Cabinet workflow returned an invalid response.')
    return payload
  }

  const session = payload.session
  if (
    payload.station !== station
    || !isRecord(session)
    || session.id === undefined
    || session.id === null
    || session.station !== station
    || !['open', 'closed'].includes(session.status)
    || !['idle', 'opening', 'closing'].includes(session.workflow_state)
  ) {
    throw new Error('Cabinet workflow returned an invalid session response.')
  }
  if (command === 'finish_open' && (session.status !== 'open' || session.workflow_state !== 'idle')) {
    throw new Error('Django did not confirm the open workflow transition.')
  }
  if (command === 'finish_close' && (session.status !== 'closed' || session.workflow_state !== 'idle')) {
    throw new Error('Django did not confirm the close workflow transition.')
  }
  if (command === 'open' && (session.status !== 'open' || session.workflow_state !== 'opening')) {
    throw new Error('Django did not confirm the opening workflow.')
  }
  if (command === 'start_close' && (session.status !== 'open' || session.workflow_state !== 'closing')) {
    throw new Error('Django did not confirm the closing workflow.')
  }
  return payload
}

async function requestWorkflow(command, { signal, fetcher = fetch, mode = 'hardware', station } = {}) {
  const mockMode = mode === 'mock'
  const url = mockMode ? '/api/cabinet/workflow/' : workflowUrl
  const body = command ? { command, station } : null
  let response
  try {
    response = await fetcher(url, {
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
  } catch (error) {
    if (error.name === 'AbortError') throw error
    const message = mockMode
      ? 'Cabinet API unavailable. Check Django and the development proxy.'
      : 'NFC bridge unavailable. Check the NFC service connection.'
    throw new Error(message, { cause: error })
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Cabinet workflow returned HTTP ${response.status}.`)
  return validateWorkflowResponse(payload, command, station, mockMode ? 'mock' : 'hardware')
}

export function fetchCabinetWorkflow(options) {
  return requestWorkflow(null, options)
}

export function sendCabinetWorkflow(command, options) {
  return requestWorkflow(command, options)
}

export async function fetchNfcServiceStatus({ signal, fetcher = fetch } = {}) {
  let response
  try {
    response = await fetcher(`${bridgeOrigin}/nfc/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('NFC bridge unavailable. Check the NFC service connection.', { cause: error })
  }
  if (!response.ok) throw new Error(`NFC bridge returned HTTP ${response.status}.`)
  const status = await response.json().catch(() => ({}))
  if (!isRecord(status) || status.service !== 'ready' || typeof status.reader_connected !== 'boolean') {
    throw new Error('NFC bridge returned an invalid status response.')
  }
  return status
}

export async function captureAccessLogPhoto(eventId, { fetcher = fetch } = {}) {
  const normalizedEventId = Number(eventId)
  if (!Number.isSafeInteger(normalizedEventId) || normalizedEventId < 1) {
    throw new Error('A valid Django access event ID is required.')
  }

  const response = await fetcher(`${new URL(scanBridgeUrl).origin}/photo/capture`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: normalizedEventId }),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.success !== true || Number(payload.event_id) !== normalizedEventId) {
    throw new Error(payload.error || 'The access photo could not be captured.')
  }
  return payload
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
    throw new Error('NFC bridge unavailable. Check the NFC service connection.', { cause: error })
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