import { useEffect, useState } from 'react'
import { Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react'
import api from '../../services/api.js'

const PHOTO_STATUS_ATTEMPTS = 5
const PHOTO_STATUS_RETRY_BASE_MS = 500
const inFlightPhotoRequests = new Map()

function requestPhotoEndpoint(url, config, signal) {
  if (signal.aborted) {
    return Promise.reject(signal.reason || new DOMException('Request aborted.', 'AbortError'))
  }

  const requestKey = JSON.stringify([
    url,
    config.params || {},
    config.responseType || '',
    config.headers?.Accept || '',
  ])
  let sharedRequest = inFlightPhotoRequests.get(requestKey)
  if (!sharedRequest) {
    const controller = new AbortController()
    sharedRequest = { controller, subscribers: 0 }
    sharedRequest.promise = api.get(url, { ...config, signal: controller.signal })
    inFlightPhotoRequests.set(requestKey, sharedRequest)
    sharedRequest.promise.then(
      () => inFlightPhotoRequests.delete(requestKey),
      () => inFlightPhotoRequests.delete(requestKey),
    )
  }

  sharedRequest.subscribers += 1
  return new Promise((resolve, reject) => {
    let released = false
    const release = () => {
      if (released) return
      released = true
      signal.removeEventListener('abort', onAbort)
      sharedRequest.subscribers -= 1
      if (sharedRequest.subscribers === 0 && inFlightPhotoRequests.get(requestKey) === sharedRequest) {
        sharedRequest.controller.abort()
      }
    }
    const onAbort = () => {
      release()
      reject(signal.reason || new DOMException('Request aborted.', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    sharedRequest.promise.then(
      (response) => {
        if (signal.aborted) return
        release()
        resolve(response)
      },
      (error) => {
        if (signal.aborted) return
        release()
        reject(error)
      },
    )
  })
}

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason || new DOMException('Request aborted.', 'AbortError'))
      return
    }

    const finish = (callback, value) => {
      window.clearTimeout(timeoutId)
      signal.removeEventListener('abort', abort)
      callback(value)
    }
    const timeoutId = window.setTimeout(() => finish(resolve), delay)
    const abort = () => finish(reject, signal.reason || new DOMException('Request aborted.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
  })
}

function retryDelay(attempt) {
  return PHOTO_STATUS_RETRY_BASE_MS * (2 ** attempt)
}

function getRequestErrorState(error) {
  const status = error.response?.status
  if (status === 401 || status === 403) {
    return { state: 'forbidden', label: 'Photo access unavailable' }
  }
  return { state: 'error', label: 'Photo could not be loaded' }
}

function isExpectedImageEndpoint(endpoint, eventId) {
  if (typeof endpoint !== 'string' || !endpoint) return false
  try {
    const apiBase = new URL(api.defaults.baseURL || '/api', window.location.origin)
    const apiPath = apiBase.pathname.replace(/\/$/, '')
    const expectedPath = `${apiPath}/access-logs/${eventId}/photo/image/`
    const imageEndpoint = new URL(endpoint, apiBase)
    return imageEndpoint.origin === apiBase.origin && imageEndpoint.pathname === expectedPath
  } catch {
    return false
  }
}

function PhotoViewer({ imageUrl, onClose }) {
  const [zoom, setZoom] = useState(1)
  const [fullSize, setFullSize] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const changeZoom = (delta) => setZoom((current) => Math.min(3, Math.max(0.5, Number((current + delta).toFixed(2)))))
  const fitToScreen = () => {
    setFullSize(false)
    setZoom(1)
  }

  return (
    <div
      className="fixed inset-0 z-[110000] flex items-center justify-center bg-black/85 p-3 sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="flex h-[94vh] w-[96vw] max-w-6xl flex-col overflow-hidden rounded-lg bg-[#111827] text-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Access event photo viewer"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/15 px-3 py-3 sm:px-5">
          <h2 className="text-sm font-semibold">Access event photo</h2>
          <div className="flex items-center gap-2">
            <button type="button" title="Zoom out" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => changeZoom(-0.25)} className="flex h-10 w-10 items-center justify-center rounded border border-white/25 hover:bg-white/10 disabled:opacity-40">
              <ZoomOut size={18} />
            </button>
            <span className="min-w-12 text-center text-xs tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" title="Zoom in" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => changeZoom(0.25)} className="flex h-10 w-10 items-center justify-center rounded border border-white/25 hover:bg-white/10 disabled:opacity-40">
              <ZoomIn size={18} />
            </button>
            <button type="button" title="Fit to screen" aria-label="Fit to screen" onClick={fitToScreen} className="min-h-10 rounded border border-white/25 px-3 text-xs font-medium hover:bg-white/10">Fit</button>
            <button type="button" title="View at full size" aria-label="View at full size" aria-pressed={fullSize} onClick={() => { setFullSize(true); setZoom(1) }} className="flex h-10 w-10 items-center justify-center rounded border border-white/25 hover:bg-white/10">
              <Maximize2 size={17} />
            </button>
            <button type="button" title="Close photo viewer" aria-label="Close photo viewer" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded border border-white/25 hover:bg-white/10">
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-2 sm:p-4">
          <img
            src={imageUrl}
            alt="Full-size captured access event"
            className={`mx-auto block origin-center ${fullSize ? '' : 'max-h-[calc(94vh-6rem)] max-w-full object-contain'}`}
            style={{ transform: `scale(${zoom})` }}
          />
        </div>
      </section>
    </div>
  )
}

function StatusOnly({ captureStatus }) {
  const label = captureStatus === 'pending'
    ? 'Pending'
    : captureStatus === 'success'
      ? 'Captured'
      : 'Photo unavailable'
  return <span className="text-xs text-slate-500">{label}</span>
}

function AuthorizedPhotoDetails({ eventId, compact }) {
  const [photo, setPhoto] = useState({ state: 'loading', label: 'Loading photo…', imageUrl: null, capturedAt: null })
  const [viewerOpen, setViewerOpen] = useState(false)
  const [retryVersion, setRetryVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let objectUrl = null
    let lastKnownState = 'error'

    const loadPhoto = async () => {
      const normalizedEventId = Number(eventId)
      if (!Number.isSafeInteger(normalizedEventId) || normalizedEventId < 1) {
        setPhoto({ state: 'error', label: 'Photo could not be loaded', imageUrl: null, capturedAt: null })
        return
      }

      for (let attempt = 0; attempt < PHOTO_STATUS_ATTEMPTS; attempt += 1) {
        if (signal.aborted) return
        try {
          const metadataResponse = await requestPhotoEndpoint(`/access-logs/${normalizedEventId}/photo/`, {
            params: { refresh: attempt },
          }, signal)
          if (signal.aborted) return
          const metadata = metadataResponse.data
          if (Number(metadata?.event_id) !== normalizedEventId) {
            setPhoto({ state: 'error', label: 'Photo event could not be verified', imageUrl: null, capturedAt: null })
            return
          }

          if (metadata.capture_status === 'pending') {
            lastKnownState = 'pending'
            setPhoto({ state: 'pending', label: 'Pending', imageUrl: null, capturedAt: null })
            if (attempt + 1 < PHOTO_STATUS_ATTEMPTS) await waitForRetry(retryDelay(attempt), signal)
            continue
          }

          if (
            metadata.capture_status === 'failed'
            || (metadata.capture_status == null && metadata.image_available === false)
            || (metadata.capture_status === 'success' && metadata.image_available === false)
          ) {
            setPhoto({ state: 'unavailable', label: 'Photo unavailable', imageUrl: null, capturedAt: null })
            return
          }

          if (metadata.capture_status !== 'success' || metadata.image_available !== true) {
            lastKnownState = 'error'
            if (attempt + 1 < PHOTO_STATUS_ATTEMPTS) await waitForRetry(retryDelay(attempt), signal)
            continue
          }

          lastKnownState = 'error'
          if (!isExpectedImageEndpoint(metadata.image_endpoint, normalizedEventId)) {
            setPhoto({ state: 'error', label: 'Photo image endpoint could not be verified', imageUrl: null, capturedAt: null })
            return
          }

          const imageResponse = await requestPhotoEndpoint(`/access-logs/${normalizedEventId}/photo/image/`, {
            responseType: 'blob',
            headers: { Accept: 'image/jpeg' },
            params: { refresh: attempt },
          }, signal)
          if (signal.aborted) return
          const contentType = imageResponse.headers?.['content-type'] || imageResponse.data?.type || ''
          if (!String(contentType).toLowerCase().startsWith('image/') || !(imageResponse.data instanceof Blob)) {
            throw new Error('Photo image response was not an image.')
          }
          const imageUrl = URL.createObjectURL(imageResponse.data)
          objectUrl = imageUrl
          setPhoto({
            state: 'captured',
            label: 'Captured',
            imageUrl,
            capturedAt: metadata.captured_at || null,
          })
          return
        } catch (error) {
          if (signal.aborted) return
          const errorState = getRequestErrorState(error)
          if (errorState.state === 'forbidden') {
            setPhoto({ ...errorState, imageUrl: null, capturedAt: null })
            return
          }
          if (lastKnownState !== 'pending') lastKnownState = 'error'
          if (attempt + 1 < PHOTO_STATUS_ATTEMPTS) await waitForRetry(retryDelay(attempt), signal)
        }
      }

      if (lastKnownState === 'pending') {
        setPhoto({ state: 'pending', label: 'Pending', imageUrl: null, capturedAt: null })
      } else {
        setPhoto({ state: 'error', label: 'Photo could not be loaded', imageUrl: null, capturedAt: null })
      }
    }

    void loadPhoto()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [eventId, retryVersion])

  const markImageUnavailable = () => {
    setViewerOpen(false)
    setPhoto({ state: 'error', label: 'Photo could not be displayed', imageUrl: null, capturedAt: null })
  }

  const retryButton = <button
    type="button"
    onClick={() => {
      setPhoto({ state: 'loading', label: 'Loading photo…', imageUrl: null, capturedAt: null })
      setRetryVersion((current) => current + 1)
    }}
    className="ml-2 text-xs font-medium text-blue-700 underline underline-offset-2"
  >
    {photo.state === 'pending' ? 'Check again' : 'Retry'}
  </button>

  if (compact) {
    if (photo.state === 'loading') return <span className="text-xs text-slate-500">Loading photo…</span>
    if (photo.state !== 'captured' || !photo.imageUrl) return <span className="text-xs text-slate-500">{photo.label}{['pending', 'error', 'forbidden'].includes(photo.state) && retryButton}</span>
    return <>
      <button type="button" title="Open access event photo" aria-label={`Open photo for access event ${eventId}`} onClick={() => setViewerOpen(true)} className="inline-flex rounded border border-slate-200 p-0.5 focus:outline-none focus:ring-2 focus:ring-blue-600">
        <img src={photo.imageUrl} alt={`Access event ${eventId} photo thumbnail`} className="h-10 w-14 rounded-sm object-cover" onError={markImageUnavailable} />
      </button>
      {viewerOpen && <PhotoViewer imageUrl={photo.imageUrl} onClose={() => setViewerOpen(false)} />}
    </>
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4" aria-label="Access event photo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Access event photo</h3>
          <p className="mt-1 text-sm text-slate-600" role={photo.state === 'loading' ? 'status' : undefined}>
            {photo.state === 'loading' ? 'Loading photo…' : photo.label}
            {['pending', 'error', 'forbidden'].includes(photo.state) && retryButton}
          </p>
          {photo.capturedAt && <time className="mt-1 block text-xs text-slate-500" dateTime={photo.capturedAt}>
            {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(photo.capturedAt))}
          </time>}
        </div>
        {photo.imageUrl && <button type="button" onClick={() => setViewerOpen(true)} className="inline-flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-white p-2 text-sm font-medium text-[#102a4c]" aria-label={`Open photo for access event ${eventId}`}>
          <img src={photo.imageUrl} alt={`Access event ${eventId} photo thumbnail`} className="h-14 w-20 rounded object-cover" onError={markImageUnavailable} />
          <span>View photo</span>
        </button>}
      </div>
      {viewerOpen && photo.imageUrl && <PhotoViewer imageUrl={photo.imageUrl} onClose={() => setViewerOpen(false)} />}
    </section>
  )
}

export default function AccessLogPhotoPanel({ eventId, captureStatus, allowImage = false, compact = false }) {
  if (!allowImage || !eventId) return <StatusOnly captureStatus={captureStatus} />
  return <AuthorizedPhotoDetails key={eventId} eventId={eventId} compact={compact} />
}