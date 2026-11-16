import { useEffect, useState } from 'react'
import { AlertCircle, Download, FileText, LoaderCircle } from 'lucide-react'
import api from '../../services/api.js'
import Modal from '../Modal.jsx'
import { authorizeAcademicFile, downloadAuthorizedFile } from './academicFileApi.js'

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function FilePreviewModal({ attachment, kind, onClose }) {
  const attachmentId = attachment?.id
  const [previewState, setPreviewState] = useState({
    attachmentId: null,
    kind: null,
    file: null,
    loading: false,
    contentLoading: false,
    error: '',
  })
  const hasCurrentPreview = previewState.attachmentId === attachmentId && previewState.kind === kind
  const file = hasCurrentPreview ? previewState.file : null
  const loading = attachmentId != null && (!hasCurrentPreview || previewState.loading)
  const contentLoading = attachmentId != null && (!hasCurrentPreview || previewState.contentLoading)
  const error = hasCurrentPreview ? previewState.error : ''

  useEffect(() => {
    if (attachmentId == null) return undefined
    let active = true

    authorizeAcademicFile(kind, attachmentId)
      .then((authorizedFile) => {
        if (active) {
          setPreviewState({
            attachmentId,
            kind,
            file: authorizedFile,
            loading: false,
            contentLoading: true,
            error: '',
          })
        }
      })
      .catch(() => {
        if (active) {
          setPreviewState({
            attachmentId,
            kind,
            file: null,
            loading: false,
            contentLoading: false,
            error: 'File unavailable. It may have been moved or deleted.',
          })
        }
      })

    return () => {
      active = false
      api.delete(`/file-previews/${kind}/${attachmentId}/authorize/`, { withCredentials: true }).catch(() => {})
    }
  }, [attachmentId, kind])

  if (!attachment) return null

  const updateCurrentPreview = (updates) => {
    setPreviewState((current) => (
      current.attachmentId === attachmentId && current.kind === kind
        ? { ...current, ...updates }
        : current
    ))
  }
  const setReady = () => updateCurrentPreview({ contentLoading: false })
  const handleContentError = () => {
    updateCurrentPreview({
      contentLoading: false,
      error: 'File unavailable. The stored file could not be retrieved.',
    })
  }
  const previewSupported = file?.preview_supported
  const previewType = file?.preview_type
  const previewError = attachmentId == null ? 'File unavailable.' : error
  const previewLoading = loading
  const filename = file?.filename || attachment.filename || attachment.file_name || 'File preview'
  const fileSize = formatBytes(file?.size ?? attachment.size ?? attachment.file_size)

  return (
    <Modal
      isOpen={Boolean(attachment)}
      onClose={onClose}
      title={filename}
      description={fileSize ? `${fileSize} · ${file?.content_type || attachment.content_type || 'File'}` : (file?.content_type || attachment.content_type || 'File preview')}
      headerIcon={<FileText size={20} />}
      closeLabel="Close file preview"
      maxWidth="min(96vw, 1152px)"
      containerClassName="max-h-[96dvh]"
      headerActions={(
        <button type="button" onClick={() => file && downloadAuthorizedFile(file)} disabled={!file || loading} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FFBE0B] px-3 text-sm font-bold text-[#082B53] hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
          <Download size={15} /> <span className="hidden sm:inline">Download</span>
        </button>
      )}
    >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-[#EAF2FB] p-2 sm:p-4">
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
    </Modal>
  )
}