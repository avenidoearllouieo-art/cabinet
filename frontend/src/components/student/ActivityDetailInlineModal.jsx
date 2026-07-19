import { useEffect, useState, useRef } from 'react'
import { Download, Upload, X, FileText, Image } from 'lucide-react'
import Modal from '../Modal.jsx'
import api from '../../services/api.js'

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

function formatBytes(bytes) {
  if (bytes == null) return '—'
  const kb = 1024
  if (bytes < kb) return `${bytes} B`
  const mb = kb * 1024
  if (bytes < mb) return `${(bytes / kb).toFixed(1)} KB`
  return `${(bytes / mb).toFixed(1)} MB`
}

export default function ActivityDetailInlineModal({ activity: initialActivity, isOpen, onClose, onSuccess }) {
  const [activity, setActivity] = useState(initialActivity || null)
  const [submission, setSubmission] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingSubmission, setLoadingSubmission] = useState(false)

  // upload form
  const [files, setFiles] = useState([])
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [comments, setComments] = useState('')
  const [errors, setErrors] = useState([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef(null)

  useEffect(() => {
    setActivity(initialActivity || null)
    setSubmission(initialActivity?.submission || null)
    if (!initialActivity) return

    // if we only have id, fetch full activity
    if (typeof initialActivity === 'number' || (initialActivity && !initialActivity.attachments)) {
      (async () => {
        try {
          const res = await api.get(`/activities/${initialActivity.id || initialActivity}/`)
          setActivity(res.data)
        } catch (err) {
          console.error('Failed to load activity', err)
        }
      })()
    }

    // fetch submission for activity
    const fetchSubmission = async () => {
      if (!initialActivity) return
      const aid = initialActivity.id || initialActivity
      setLoadingSubmission(true)
      try {
        const res = await api.get('/submissions/', { params: { activity: aid, page_size: 1 } })
        const results = Array.isArray(res.data) ? res.data : res.data.results || []
        setSubmission(results[0] || null)
      } catch (err) {
        console.error('Failed to load submission', err)
      } finally {
        setLoadingSubmission(false)
      }
    }
    fetchSubmission()
  }, [initialActivity, isOpen])

  const isOverdue = activity?.due_date && new Date(activity.due_date) < new Date()
  const canSubmit = !isOverdue || activity?.allow_late_submission

  const handleFileSelect = async (e) => {
    const selectedFiles = Array.from(e.target.files || [])
    if (!selectedFiles.length) return
    setErrors([])
    setUploadProgress(0)
    setLoading(true)
    try {
      const formData = new FormData()
      selectedFiles.forEach((f) => formData.append('files', f))
      formData.append('activity', activity.id)
      const res = await api.post('/student/submissions/upload', formData, {
        onUploadProgress: (ev) => {
          if (ev.total) setUploadProgress(Math.round((ev.loaded * 100) / ev.total))
        }
      })
      const ups = res.data.uploads || []
      setUploadedFiles((prev) => [...prev, ...ups])
      setFiles((prev) => [...prev, ...selectedFiles])
    } catch (err) {
      setErrors(['Failed to upload files.'])
    } finally {
      setLoading(false)
      setUploadProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const dropped = Array.from(e.dataTransfer?.files || [])
    if (dropped.length) handleFileSelect({ target: { files: dropped } })
  }
  const handleDragOver = (e) => { e.preventDefault() }

  const handleRemoveFile = (index) => {
    const removed = uploadedFiles[index]
    setFiles((p) => p.filter((_, i) => i !== index))
    if (removed?.id) api.delete(`/temp-uploads/${removed.id}/`).catch(() => {})
    setUploadedFiles((p) => p.filter((u) => u.id !== removed?.id))
  }

  const handleSubmit = async () => {
    if (!uploadedFiles.length) { setErrors(['Upload at least one file draft.']); return }
    if (!confirm('Submit your files?')) return
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('activity', activity.id)
      formData.append('remarks', comments)
      uploadedFiles.forEach((u) => formData.append('temp_upload_ids', u.id))
      await api.post('/submissions/', formData)
      // refresh submission
      const res = await api.get('/submissions/', { params: { activity: activity.id, page_size: 1 } })
      const results = Array.isArray(res.data) ? res.data : res.data.results || []
      setSubmission(results[0] || null)
      setFiles([])
      setUploadedFiles([])
      setComments('')
      window.alert('Submission created successfully.')
      onSuccess && onSuccess()
    } catch (err) {
      setErrors(['Failed to submit.'])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Activity Details">
      {!activity ? (
        <p className="text-sm text-slate-600">Activity details are unavailable.</p>
      ) : (
        <div className="space-y-6">
          <div className="rounded-[12px] border bg-slate-50 p-4">
            <h3 className="text-lg font-semibold">{activity.title}</h3>
            <p className="text-sm text-slate-500">Instructor: {activity.instructor_name || 'Unassigned'}</p>
          </div>

          <div className="rounded-[12px] border bg-white p-4">
            <h4 className="font-semibold">Attachments</h4>
            {activity.attachments?.length ? (
              <div className="space-y-2 mt-3">
                {activity.attachments.map((att) => (
                  <div key={att.id} className="flex items-center justify-between rounded bg-slate-50 p-2">
                    <div>
                      <div className="font-medium">{att.filename || att.file_name}</div>
                      <div className="text-xs text-slate-500">{formatBytes(att.size)}</div>
                    </div>
                    <a href={att.url} target="_blank" rel="noreferrer" className="rounded-full bg-slate-900 px-3 py-1 text-white text-sm"> <Download size={14} /> Download</a>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500 mt-2">No attachments.</div>
            )}
          </div>

          <div className="rounded-[12px] border bg-white p-4">
            <h4 className="font-semibold">Submission Status</h4>
            <div className="mt-2 text-sm text-slate-700">{submission ? 'Submitted' : 'Not Submitted'}</div>
            <div className="mt-3">
              <h5 className="font-semibold">Your Work</h5>
              {submission ? (
                <div className="mt-2 space-y-2">
                  {(submission.attachments || []).map((att) => (
                    <div key={att.id} className="flex items-center justify-between rounded bg-white p-2">
                      <div>
                        <div className="font-medium">{att.file_name}</div>
                        <div className="text-xs text-slate-500">{formatBytes(att.file_size)}</div>
                      </div>
                      <a href={att.download_url} target="_blank" rel="noreferrer" className="rounded-full bg-slate-900 px-3 py-1 text-white text-sm"><Download size={14} /> Download</a>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3">
                  <div onDrop={handleDrop} onDragOver={handleDragOver} className="rounded border-2 border-dashed p-6 text-center bg-slate-50">
                    <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-white"> <Upload size={16} /> Choose Files</button>
                    <div className="text-xs text-slate-500 mt-2">Supported: PDF, images, ZIP. Max 20 MB per file</div>
                  </div>

                  {files.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {files.map((file, i) => (
                        <div key={`${file.name}-${i}`} className="flex items-center justify-between bg-white p-2 rounded border">
                          <div className="flex items-center gap-3">
                            {file.type?.startsWith('image/') ? <Image size={18} /> : <FileText size={18} />}
                            <div>
                              <div className="font-medium">{uploadedFiles[i]?.name || file.name}</div>
                              <div className="text-xs text-slate-500">{formatBytes(uploadedFiles[i]?.size || file.size)}</div>
                            </div>
                          </div>
                          <button onClick={() => handleRemoveFile(i)} className="p-2 rounded hover:bg-red-50"><X size={16} className="text-red-600" /></button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3">
                    <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} placeholder="Comments (optional)" className="w-full rounded border p-2" />
                  </div>

                  {errors.length > 0 && (
                    <div className="mt-3 text-sm text-red-600">
                      {errors.map((er, i) => <div key={i}>• {er}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 justify-end">
            <button onClick={onClose} className="rounded-full border px-4 py-2">Cancel</button>
            <button onClick={handleSubmit} disabled={!canSubmit || loading || uploadedFiles.length === 0} className="rounded-full bg-blue-600 text-white px-4 py-2">Submit Activity</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
