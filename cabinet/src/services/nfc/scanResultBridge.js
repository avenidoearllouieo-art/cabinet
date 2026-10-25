const DEFAULT_SCAN_BRIDGE_URL = '/nfc-bridge/api/scans'

const configuredScanBridgeUrl = (import.meta.env.VITE_NFC_BRIDGE_URL || DEFAULT_SCAN_BRIDGE_URL).replace(/\/$/, '')
const scanBridge = new URL(configuredScanBridgeUrl, window.location.origin)
const scanBridgeUrl = scanBridge.toString()
const bridgeOrigin = scanBridge.origin
const bridgePathPrefix = scanBridge.pathname.replace(/\/api\/scans\/?$/, '').replace(/\/$/, '')
const bridgeEndpoint = (path) => `${bridgeOrigin}${bridgePathPrefix}${path}`
const workflowUrl = bridgeEndpoint('/cabinet/workflow')
const recoveryHandoffUrl = bridgeEndpoint('/password-reset/handoff')
const recoveryCancelUrl = bridgeEndpoint('/password-reset/cancel')
const recoveryStatusUrl = bridgeEndpoint('/password-reset/bridge-status')
const recoveryQueueUrl = bridgeEndpoint('/password-reset/queue')
const djangoApiBase = (import.meta.env?.VITE_DJANGO_API_BASE_URL || '/api').replace(/\/$/, '')
const passwordResetStatusUrl = `${djangoApiBase}/auth/password-reset/status/`

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function postJson(url, body, { fetcher = fetch, signal, credentials } = {}, label) {
  let response
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      ...(signal ? { signal } : {}),
      ...(credentials ? { credentials } : {}),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(`${label} service unavailable. Check the connection and try again.`, { cause: error })
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`${label} returned malformed JSON.`)
  }
  if (!isRecord(payload)) throw new Error(`${label} returned an invalid response.`)
  if (!response.ok) {
    const message = payload.error || payload.detail || `${label} returned HTTP ${response.status}.`
    if (
      label === 'Password-recovery handoff'
      && response.status === 404
      && /^not found\.?$/i.test(String(message).trim())
    ) {
      throw new Error('The Pi NFC service does not recognize the password-recovery handoff route. Check its running version and Cabinet bridge URL.')
    }
    throw new Error(message)
  }
  return payload
}

export async function startPasswordRecovery(requestId, options = {}) {
  const normalizedRequestId = String(requestId || '')
  if (!normalizedRequestId || normalizedRequestId.length > 128 || normalizedRequestId.trim() !== normalizedRequestId) {
    throw new Error('Enter a valid password-reset request ID.')
  }
  const payload = await postJson(
    recoveryHandoffUrl,
    { request_id: normalizedRequestId },
    options,
    'Password-recovery handoff',
  )
  if (
    payload.request_id !== normalizedRequestId
    || payload.state !== 'waiting'
    || typeof payload.message !== 'string'
    || typeof payload.expires_at !== 'string'
  ) {
    throw new Error('Password-recovery bridge returned an invalid handoff response.')
  }
  return payload
}

export async function fetchPasswordRecoveryQueue({ signal, fetcher = fetch } = {}) {
    let response
    try {
        response = await fetcher(recoveryQueueUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal,
        })
    } catch (error) {
        if (error.name === 'AbortError') throw error
        throw new Error('Password-recovery queue unavailable. Check the NFC bridge connection.', { cause: error })
    }
    let payload
    try {
        payload = await response.json()
    } catch {
        throw new Error('Password-recovery queue returned malformed JSON.')
    }
    if (!response.ok) {
        const message = isRecord(payload) ? (payload.error || payload.detail) : ''
        if (response.status === 404 && /^not found\.?$/i.test(String(message || '').trim())) {
            throw new Error('The Pi NFC service does not provide the password-recovery queue. Restart it from the current nfc_service.py and verify port 5001.')
        }
        throw new Error(message || `Password-recovery queue returned HTTP ${response.status}.`)
    }
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
        throw new Error('Password-recovery queue returned an invalid response.')
    }
    return payload.results
        .filter((item) => (
            isRecord(item)
            && typeof item.request_id === 'string'
            && typeof item.display_name === 'string'
            && typeof item.account_reference === 'string'
            && typeof item.status === 'string'
        ))
        .map(({ request_id, display_name, account_reference, status }) => ({
            request_id,
            display_name,
            account_reference,
            status,
        }))
}

export async function cancelPasswordRecovery(requestId, options = {}) {
  const payload = await postJson(
    recoveryCancelUrl,
    { request_id: String(requestId || '') },
    options,
    'Password-recovery cancellation',
  )
  if (typeof payload.cancelled !== 'boolean') {
    throw new Error('Password-recovery bridge returned an invalid cancellation response.')
  }
  return payload
}

export async function fetchPasswordRecoveryBridgeStatus(requestId, { signal, fetcher = fetch } = {}) {
  const url = new URL(recoveryStatusUrl)
  url.searchParams.set('request_id', String(requestId || ''))
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
    throw new Error('Password-recovery bridge unavailable. Check the NFC service connection.', { cause: error })
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('Password-recovery bridge returned malformed JSON.')
  }
  if (!response.ok || !isRecord(payload)) {
    throw new Error(payload?.error || `Password-recovery bridge returned HTTP ${response.status}.`)
  }
  if (payload.state !== 'idle' && (
    payload.request_id !== String(requestId)
    || typeof payload.state !== 'string'
    || typeof payload.message !== 'string'
  )) {
    throw new Error('Password-recovery bridge returned an invalid status response.')
  }
  return payload
}

export async function fetchPasswordRecoveryStatus(requestId, { signal, fetcher = fetch } = {}) {
  const payload = await postJson(
    passwordResetStatusUrl,
    { request_id: String(requestId || '') },
    { signal, fetcher, credentials: 'same-origin' },
    'Password-reset status',
  )
  const status = payload.status ?? payload.state
  if (
    (payload.request_id !== undefined && payload.request_id !== String(requestId))
    || typeof status !== 'string'
    || !status.trim()
  ) {
    throw new Error('Password-reset status returned an invalid response.')
  }
  const normalizedStatus = status.toLowerCase()
  if (normalizedStatus === 'verified' && (
    typeof payload.reset_authorization !== 'string'
    || !payload.reset_authorization
  )) {
    throw new Error('Password-reset status returned an invalid verification response.')
  }
  return { ...payload, status: normalizedStatus }
}

function isValidSession(session, station) {
  return isRecord(session)
    && session.id !== undefined
    && session.id !== null
    && session.station === station
    && ['open', 'closed'].includes(session.status)
    && ['idle', 'opening', 'closing'].includes(session.workflow_state)
    && Array.isArray(session.opened_by)
    && Array.isArray(session.closed_by)
}

function validateWorkflowResponse(payload, command, station, expectedMode) {
  if (!isRecord(payload) || payload.mode !== expectedMode) {
    throw new Error('Cabinet workflow returned an invalid response.')
  }
  if (!command) {
    if (!Array.isArray(payload.stations) || !payload.stations.every((item) => (
      isRecord(item)
      && typeof item.name === 'string'
      && Boolean(item.name.trim())
      && ['available', 'occupied'].includes(item.status)
      && (item.session === null || isValidSession(item.session, item.name))
    ))) {
      throw new Error('Cabinet workflow returned an invalid response.')
    }
    return payload
  }

  const session = payload.session
  if (
    payload.station !== station
    || !isValidSession(session, station)
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

async function requestWorkflow(command, { signal, fetcher = fetch, station } = {}) {
  const body = command ? { command, station } : null
  let response
  try {
    response = await fetcher(workflowUrl, {
      method: command ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('NFC bridge unavailable. Check the NFC service connection.', { cause: error })
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Cabinet workflow returned HTTP ${response.status}.`)
  return validateWorkflowResponse(payload, command, station, 'hardware')
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
    response = await fetcher(bridgeEndpoint('/nfc/status'), {
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

  const response = await fetcher(bridgeEndpoint('/photo/capture'), {
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