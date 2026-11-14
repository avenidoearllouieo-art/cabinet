import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Download, LoaderCircle, X } from 'lucide-react'
import api from '../../services/api.js'
import { authorizeAcademicFile, downloadAuthorizedFile } from './academicFileApi.js'

export default function FilePreviewModal({ attachment, kind, onClose }) {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(true)
  const [error, setError] = useState('')
  const attachmentId = attachment?.id

  useEffect(() => {
    if (attachmentId == null) return undefined
    let active = true

    authorizeAcademicFile(kind, attachmentId)
      .then((authorizedFile) => {
        if (active) setFile(authorizedFile)
      })
      .catch(() => {
        if (active) setError('File unavailable. It may have been moved or deleted.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      api.delete(`/file-previews/${kind}/${attachmentId}/authorize/`, { withCredentials: true }).catch(() => {})
    }
  }, [attachmentId, kind])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  if (!attachment) return null

  const setReady = () => setContentLoading(false)
  const handleContentError = () => {
    setContentLoading(false)
    setError('File unavailable. The stored file could not be retrieved.')
  }
  const previewSupported = file?.preview_supported
  const previewType = file?.preview_type
  const previewError = attachmentId == null ? 'File unavailable.' : error
  const previewLoading = loading && attachmentId != null

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-slate-950/75 p-2 sm:p-5"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={file?.filename || attachment.filename || attachment.file_name || 'File preview'}
        className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:px-5">
          <h2 className="min-w-0 truncate text-base font-bold text-[#0B1F3A] sm:text-lg">
            {file?.filename || attachment.filename || attachment.file_name || 'File preview'}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => file && downloadAuthorizedFile(file)}
              disabled={!file || loading}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#0B1F3A] px-3 text-sm font-semibold text-white hover:bg-[#173d68] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={15} /> <span className="hidden sm:inline">Download</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
              aria-label="Close file preview"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 overflow-auto bg-slate-100 p-2 sm:p-4">
          {previewLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100/90 text-sm font-medium text-slate-600" role="status">
              <LoaderCircle size={18} className="mr-2 animate-spin" /> Loading preview…
            </div>
          )}
          {previewError && (
            <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center text-sm text-rose-700" role="alert">
              <AlertCircle size={24} />
              <span>{previewError}</span>
            </div>
          )}
          {!previewLoading && !previewError && !previewSupported && (
            <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center text-sm text-slate-600">
              <AlertCircle size={24} />
              <span>Preview unavailable for this file type.</span>
              <button type="button" onClick={() => downloadAuthorizedFile(file)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#0B1F3A] px-4 font-semibold text-white hover:bg-[#173d68]">
                <Download size={15} /> Download file
              </button>
            </div>
          )}
          {file && previewSupported && contentLoading && !previewError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100/80 text-sm text-slate-600" role="status">
              <LoaderCircle size={18} className="mr-2 animate-spin" /> Loading file…
            </div>
          )}
          {file && previewType === 'video' && !previewError && (
            <video src={file.content_url} controls playsInline preload="metadata" onLoadedMetadata={setReady} onCanPlay={setReady} onError={handleContentError} className="mx-auto max-h-[78dvh] w-full rounded-lg bg-black" />
          )}
          {file && previewType === 'audio' && !previewError && (
            <div className="flex min-h-52 items-center justify-center">
              <audio src={file.content_url} controls preload="metadata" onLoadedMetadata={setReady} onError={handleContentError} className="w-full max-w-2xl" />
            </div>
          )}
          {file && previewType === 'image' && !previewError && (
            <img src={file.content_url} alt={file.filename} onLoad={setReady} onError={handleContentError} className="mx-auto max-h-[78dvh] max-w-full object-contain" />
          )}
          {file && ['pdf', 'text'].includes(previewType) && !previewError && (
            <iframe src={file.content_url} title={file.filename} onLoad={setReady} className="h-[78dvh] min-h-72 w-full rounded-lg border border-slate-300 bg-white" />
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}