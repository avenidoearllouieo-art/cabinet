import { useEffect, useState } from 'react'

export default function AccessPhotoDetails({ photo }) {
  if (!photo) return null

  return (
    <section className={`access-photo-details photo-${photo.state}`} aria-label="Access photo details">
      <div className="access-photo-status">
        <strong>Photo</strong>
        <span className={`photo-state-indicator photo-state-${photo.state}`}>{photo.label}</span>
      </div>
      {photo.capturedAt && <time className="access-photo-time" dateTime={photo.capturedAt}>
        {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(photo.capturedAt))}
      </time>}
      {photo.imageBlob
        ? <PhotoPreview imageBlob={photo.imageBlob} />
        : <p className="access-photo-placeholder">
          {photo.state === 'pending' ? 'Photo capture is pending.' : photo.state === 'loading' ? 'Checking photo status…' : 'No photo is available for this scan.'}
        </p>}
      {photo.diagnosticError && <p className="access-photo-diagnostic">{photo.diagnosticError}</p>}
    </section>
  )
}

function PhotoPreview({ imageBlob }) {
  const [isOpen, setIsOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(imageBlob)
    const frameId = window.requestAnimationFrame(() => setImageUrl(objectUrl))
    return () => {
      window.cancelAnimationFrame(frameId)
      URL.revokeObjectURL(objectUrl)
    }
  }, [imageBlob])

  useEffect(() => {
    if (!isOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isOpen])

  if (!imageUrl || imageFailed) {
    return <p className="access-photo-placeholder">Photo preview is unavailable.</p>
  }

  return (
    <>
      <button className="access-photo-preview-trigger" type="button" onClick={() => setIsOpen(true)} aria-label="Open captured photo preview">
        <img src={imageUrl} alt="Captured access event" onError={() => setImageFailed(true)} />
        <span>View photo</span>
      </button>
      {isOpen && <div className="photo-preview-backdrop" role="presentation" onClick={() => setIsOpen(false)}>
        <section className="photo-preview-dialog" role="dialog" aria-modal="true" aria-label="Captured access photo" onClick={(event) => event.stopPropagation()}>
          <button className="photo-preview-close" type="button" onClick={() => setIsOpen(false)} aria-label="Close photo preview">×</button>
          <img src={imageUrl} alt="Full-size captured access event" onError={() => setImageFailed(true)} />
        </section>
      </div>}
    </>
  )
}