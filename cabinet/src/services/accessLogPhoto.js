const configuredApiBase = import.meta.env?.VITE_DJANGO_API_BASE_URL || '/api'
const API_BASE_URL = /^https?:\/\//i.test(configuredApiBase)
  ? new URL(configuredApiBase).pathname.replace(/\/$/, '')
  : configuredApiBase.replace(/\/$/, '')
const NFC_MODE = (import.meta.env?.VITE_NFC_MODE || (import.meta.env?.DEV ? 'mock' : 'hardware')).toLowerCase()
const photoReadHeaders = {
  Accept: 'application/json',
  ...(NFC_MODE === 'mock' ? { 'X-TapTrack-Mock-Mode': 'true' } : {}),
}

export function getDjangoAccessLogEventId(scanEvent) {
  const eventId = Number(scanEvent?.django_response?.event_id)
  return Number.isSafeInteger(eventId) && eventId > 0 ? eventId : null
}

export function mapPhotoStatus(captureStatus, imageAvailable) {
  if (captureStatus === 'pending') return { label: 'Pending', state: 'pending' }
  if (captureStatus === 'success' && imageAvailable) return { label: 'Captured', state: 'captured' }
  return { label: 'Unavailable', state: 'unavailable' }
}

export async function fetchAccessLogPhoto(eventId, { fetcher = fetch } = {}) {
  const normalizedEventId = Number(eventId)
  if (!Number.isSafeInteger(normalizedEventId) || normalizedEventId < 1) {
    throw new Error('A valid Django access event ID is required.')
  }

  const eventPath = `${API_BASE_URL}/access-logs/${normalizedEventId}/photo/`
  const metadataResponse = await fetcher(eventPath, {
    method: 'GET',
    headers: photoReadHeaders,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!metadataResponse.ok) throw new Error(`Photo status returned HTTP ${metadataResponse.status}.`)

  const metadata = await metadataResponse.json()
  if (!metadata || Number(metadata.event_id) !== normalizedEventId) {
    throw new Error('Photo status did not match the Django access event.')
  }

  const mappedStatus = mapPhotoStatus(metadata.capture_status, metadata.image_available)
  let imageBlob = null
  const expectedImageEndpoint = `${eventPath}image/`
  if (mappedStatus.state === 'captured' && metadata.image_endpoint !== expectedImageEndpoint) {
    return {
      eventId: normalizedEventId,
      ...mapPhotoStatus('failed', false),
      capturedAt: metadata.captured_at || null,
      diagnosticError: 'Photo image endpoint is unavailable.',
      imageBlob: null,
    }
  }
  if (mappedStatus.state === 'captured') {
    const imageResponse = await fetcher(expectedImageEndpoint, {
      method: 'GET',
      headers: {
        ...photoReadHeaders,
        Accept: 'image/jpeg',
      },
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (imageResponse.ok) {
      const contentType = imageResponse.headers.get('Content-Type') || ''
      if (!contentType.toLowerCase().startsWith('image/')) {
        throw new Error('Photo image response was not an image.')
      }
      imageBlob = await imageResponse.blob()
    } else {
      return {
        eventId: normalizedEventId,
        ...mapPhotoStatus('failed', false),
        capturedAt: metadata.captured_at || null,
        diagnosticError: 'Photo image is unavailable.',
        imageBlob: null,
      }
    }
  }

  return {
    eventId: normalizedEventId,
    ...mappedStatus,
    capturedAt: metadata.captured_at || null,
    diagnosticError: metadata.diagnostic_error || null,
    imageBlob,
  }
}