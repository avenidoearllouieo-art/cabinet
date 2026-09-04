import { useEffect, useRef, useState } from 'react'
import { Upload, X, FileText, Image, Clock3, AlertCircle, CheckCircle2 } from 'lucide-react'
import Modal from '../Modal.jsx'
import api from '../../services/api.js'

function formatBytes(bytes) {
  if (bytes == null) return '—'
  const kb = 1024
  if (bytes < kb) return `${bytes} B`
  const mb = kb * 1024
  if (bytes < mb) return `${(bytes / kb).toFixed(1)} KB`
  return `${(bytes / mb).toFixed(1)} MB`
}

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return String(value)
  }
}

export default function ActivitySubmitModal({ activity, isOpen, onClose, onSuccess }) {
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [successMessage, setSuccessMessage] = useState('')
  const [submission, setSubmission] = useState(null)
  const [remarks, setRemarks] = useState('')
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState([])
  const fileInputRef = useRef(null)

  const resetState = () => {
    setUploadedFiles([])
    setErrors([])
    setUploadProgress(0)
    setSuccessMessage('')
    setSubmission(null)
    setRemarks('')
    setRemovedAttachmentIds([])
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      if (!isOpen) {
        resetState()
        return
      }
      if (!activity?.id) return
      setLoading(true)
      setErrors([])
      try {
        const res = await api.get('/submissions/', { params: { activity: activity.id, ordering: '-submitted_at', page_size: 5 } })
        const results = Array.isArray(res.data) ? res.data : res.data.results || []
        const latest = results[0] || null
        setSubmission(latest)
        setRemarks(latest?.remarks || '')
        const existingFiles = (latest?.files || []).map((file) => ({ ...file, source: 'existing', attachmentId: file.id }))
        setUploadedFiles(existingFiles)
        setRemovedAttachmentIds([])
      } catch (err) {
        console.error('Failed to load existing submission', err)
      } finally {
        setLoading(false)
      }
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [activity?.id, isOpen])

  const isDeadlinePassed = Boolean(activity?.due_date && new Date(activity.due_date) < new Date())
  const canEditSubmission = !submission || (!isDeadlinePassed || Boolean(activity?.allow_resubmission))

  const handleFileSelect = async (event) => {
    const selectedFiles = Array.from(event.target.files || [])
    if (!selectedFiles.length) return
    setErrors([])
    setUploadProgress(0)
    setLoading(true)
    try {
      const formData = new FormData()
      selectedFiles.forEach((file) => formData.append('files', file))
      formData.append('activity', activity.id)
      const res = await api.post('/student/submissions/upload', formData, {
        onUploadProgress: (event) => {
          if (event.total) setUploadProgress(Math.round((event.loaded * 100) / event.total))
        },
      })
      const uploads = Array.isArray(res.data?.uploads) ? res.data.uploads : [res.data]
      const nextFiles = uploads.map((upload) => ({ ...upload, source: 'temp', tempUploadId: upload.id }))
      setUploadedFiles((prev) => [...prev, ...nextFiles])
      setSuccessMessage('Files uploaded as draft.')
    } catch (err) {
      console.error(err)
      setErrors(['Failed to upload files.'])
    } finally {
      setLoading(false)
      setUploadProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDrop = (event) => {
    event.preventDefault()
    const droppedFiles = Array.from(event.dataTransfer?.files || [])
    if (droppedFiles.length) handleFileSelect({ target: { files: droppedFiles } })
  }

  const handleRemoveFile = (index) => {
    const removed = uploadedFiles[index]
    const nextFiles = uploadedFiles.filter((_, itemIndex) => itemIndex !== index)
    setUploadedFiles(nextFiles)

    if (removed?.source === 'existing' && removed?.attachmentId) {
      setRemovedAttachmentIds((prev) => (prev.includes(removed.attachmentId) ? prev : [...prev, removed.attachmentId]))
    } else if (removed?.source === 'temp' && removed?.tempUploadId) {
      api.delete(`/temp-uploads/${removed.tempUploadId}/`).catch(() => {})
    }
  }

  const handleSubmit = async () => {
    if (!uploadedFiles.length) {
      setErrors(['Upload at least one file to submit.'])
      return
    }
    if (!canEditSubmission) {
      setErrors(['The deadline has passed and late submissions are not allowed.'])
      return
    }
    if (!confirm(submission?.id ? 'Update your submission?' : 'Submit your files?')) return

    setLoading(true)
    setErrors([])
    try {
      const formData = new FormData()
      formData.append('activity', activity.id)
      formData.append('remarks', remarks.trim())

      uploadedFiles.forEach((upload) => {
        if (upload?.source === 'temp' && upload?.id) formData.append('temp_upload_ids', upload.id)
      })

      removedAttachmentIds.forEach((id) => formData.append('removed_attachment_ids', id))

      if (submission?.id) {
        await api.patch(`/submissions/${submission.id}/`, formData)
        setSuccessMessage('Submission updated successfully.')
      } else {
        await api.post('/submissions/', formData)
        setSuccessMessage('Submission created successfully.')
      }

      setUploadedFiles([])
      setRemarks('')
      setRemovedAttachmentIds([])
      onSuccess && onSuccess()
      window.dispatchEvent(new CustomEvent('studentSubmissionSaved'))
    } catch (err) {
      console.error(err)
      setErrors(['Failed to save submission.'])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={submission?.id ? 'Update Submission' : 'Submit Activity'} description="Upload files and add optional context for your instructor." dirty={Boolean(remarks || uploadedFiles.some((file) => file.source === 'temp') || removedAttachmentIds.length)} busy={loading}>
      {!activity ? (
        <p className="text-sm text-slate-600">Activity is unavailable.</p>
      ) : (
        <div className="space-y-6">
          <div className="rounded-[16px] border border-[#E5E7EB] bg-slate-50 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900">{activity.title}</h3>
              {submission?.id ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 size={14} /> Existing submission loaded
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-slate-500">Review the latest saved files, add new ones, or replace existing attachments before the deadline.</p>
          </div>

          {submission?.id ? (
            <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                  <Clock3 size={14} /> Submitted {formatDate(submission.submitted_at)}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                  {submission.score != null ? <><CheckCircle2 size={14} /> Graded {submission.score}</> : <><AlertCircle size={14} /> Pending review</>}
                </span>
              </div>
              {submission.remarks ? <p className="mt-3 text-sm leading-6 text-slate-700">Notes: {submission.remarks}</p> : null}
            </div>
          ) : null}

          <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-6">
            <label className="mb-2 block text-sm font-semibold text-slate-900" htmlFor="submission-notes">Notes</label>
            <textarea
              id="submission-notes"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              rows={3}
              placeholder="Add any context or notes for your submission"
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-900"
            />

            <div onDrop={handleDrop} onDragOver={(event) => event.preventDefault()} className="mt-4 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition hover:border-[#F5B700]">
              <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#F5B700] px-6 py-3 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:bg-slate-300">
                <Upload size={18} /> Choose Files
              </button>
              <p className="mt-3 text-sm text-slate-500">Drag and drop files here or click to select.</p>
            </div>

            {uploadProgress > 0 && (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500">Uploading: {uploadProgress}%</p>
              </div>
            )}

            {uploadedFiles.length > 0 && (
              <div className="mt-4 space-y-3">
                {uploadedFiles.map((file, index) => (
                  <div key={file.id || `${file.name}-${index}`} className="flex items-center justify-between rounded-[12px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-3">
                      {file.content_type?.startsWith('image/') ? <Image size={20} className="text-slate-500" /> : <FileText size={20} className="text-slate-500" />}
                      <div>
                        <p className="font-medium text-slate-900">{file.name || file.filename || 'Uploaded file'}</p>
                        <p className="text-xs text-slate-500">{formatBytes(file.size || file.file_size)}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => handleRemoveFile(index)} className="flex h-11 w-11 items-center justify-center rounded-xl text-red-600 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-600" aria-label={`Remove ${file.name || file.filename || 'file'}`}>
                      <X size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {errors.length > 0 && (
              <div className="mt-4 rounded-[12px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {errors.map((err, item) => <p key={item}>• {err}</p>)}
              </div>
            )}

            {successMessage && (
              <div className="mt-4 rounded-[12px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{successMessage}</div>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={loading} className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:bg-slate-100">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={loading || !canEditSubmission || uploadedFiles.length === 0} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#F5B700] px-6 py-3 text-sm font-bold text-[#0B1F3A] transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-blue-900 disabled:bg-slate-300">
              {loading ? (submission?.id ? 'Updating...' : 'Submitting...') : canEditSubmission ? (submission?.id ? 'Update Submission' : 'Submit Activity') : 'Submission Closed'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
