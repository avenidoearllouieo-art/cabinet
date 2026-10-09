import { useEffect, useState } from 'react'
import api from '../../services/api.js'

function mapCaptureStatus(status, imageAvailable) {
  if (status === 'pending') return { label: 'Pending', state: 'pending' }
  if (status === 'success' && imageAvailable) return { label: 'Captured', state: 'captured' }
  return { label: 'Unavailable', state: 'unavailable' }
}

function StatusOnly({ captureStatus }) {
  const status = captureStatus === 'pending'
    ? 'Pending'
    : captureStatus === 'success'
      ? 'Captured'
      : 'Unavailable'
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4" aria-label="Photo capture status">
      <h3 className="text-sm font-semibold text-slate-800">Photo capture</h3>
      <p className="mt-2 text-sm text-slate-600">{status}</p>
    </section>
  )
}

function AuthorizedPhotoDetails({ eventId }) {
  const [photo, setPhoto] = useState({ state: 'loading', label: 'Checking…', imageUrl: null, capturedAt: null })
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl = null

    const loadPhoto = async () => {
      try {
        const metadataResponse = await api.get(`/access-logs/${eventId}/photo/`)
        const metadata = metadataResponse.data
        if (Number(metadata?.event_id) !== Number(eventId)) {
          throw new Error('Photo metadata did not match the access log.')
        }

        let nextPhoto = {
          ...mapCaptureStatus(metadata.capture_status, metadata.image_available),
          imageUrl: null,
          capturedAt: metadata.captured_at || null,
        }
        const expectedPath = `/api/access-logs/${eventId}/photo/image/`
        if (nextPhoto.state === 'captured') {
          const endpoint = new URL(metadata.image_endpoint || '', window.location.origin)
          if (endpoint.origin !== window.location.origin || endpoint.pathname !== expectedPath) {
            throw new Error('Photo image endpoint is invalid.')
          }

          const imageResponse = await api.get(`/access-logs/${eventId}/photo/image/`, {
            responseType: 'blob',
            headers: { Accept: 'image/jpeg' },
          })
          const contentType = imageResponse.headers?.['content-type'] || imageResponse.data?.type || ''
          if (!String(contentType).toLowerCase().startsWith('image/')) {
            throw new Error('Photo image response was not an image.')
          }
          objectUrl = URL.createObjectURL(imageResponse.data)
          nextPhoto = { ...nextPhoto, imageUrl: objectUrl }
        }
        if (active) setPhoto(nextPhoto)
      } catch {
        if (active) setPhoto({ state: 'unavailable', label: 'Unavailable', imageUrl: null, capturedAt: null })
      }
    }

    void loadPhoto()
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [eventId])

  if (photo.state === 'loading') {
    return (
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4" aria-label="Photo capture status">
        <h3 className="text-sm font-semibold text-slate-800">Photo capture</h3>
        <p className="mt-2 text-sm text-slate-600">Checking…</p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4" aria-label="Photo capture status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Photo capture</h3>
          <p className="mt-1 text-sm text-slate-600">{photo.label}</p>
          {photo.capturedAt && <time className="mt-1 block text-xs text-slate-500" dateTime={photo.capturedAt}>
            {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(photo.capturedAt))}
          </time>}
        </div>
        {photo.imageUrl && <button type="button" onClick={() => setPreviewOpen(true)} className="inline-flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-white p-2 text-sm font-medium text-[#102a4c]" aria-label="Open captured access photo">
          <img src={photo.imageUrl} alt="Captured access event" className="h-14 w-20 rounded object-cover" onError={() => setPhoto((current) => ({ ...current, state: 'unavailable', label: 'Unavailable', imageUrl: null }))} />
          <span>View photo</span>
        </button>}
      </div>
      {previewOpen && photo.imageUrl && <div className="fixed inset-0 z-[100000] grid place-items-center bg-black/75 p-4" role="presentation" onClick={() => setPreviewOpen(false)}>
        <section className="relative max-h-[90vh] w-full max-w-4xl rounded-lg bg-white p-4 pt-14" role="dialog" aria-modal="true" aria-label="Captured access photo" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="absolute right-3 top-2 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-xl" onClick={() => setPreviewOpen(false)} aria-label="Close photo preview">×</button>
          <img src={photo.imageUrl} alt="Full-size captured access event" className="mx-auto max-h-[78vh] max-w-full object-contain" onError={() => setPhoto((current) => ({ ...current, state: 'unavailable', label: 'Unavailable', imageUrl: null }))} />
        </section>
      </div>}
    </section>
  )
}

export default function AccessLogPhotoPanel({ eventId, captureStatus, allowImage = false }) {
  if (!allowImage || !eventId) return <StatusOnly captureStatus={captureStatus} />
  return <AuthorizedPhotoDetails key={eventId} eventId={eventId} />
}
