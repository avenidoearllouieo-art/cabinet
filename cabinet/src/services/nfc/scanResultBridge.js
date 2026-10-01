const DEFAULT_SCAN_BRIDGE_URL = 'http://127.0.0.1:5001/api/scans'

const scanBridgeUrl = (import.meta.env.VITE_NFC_BRIDGE_URL || DEFAULT_SCAN_BRIDGE_URL).replace(/\/$/, '')

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