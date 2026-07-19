import { useMemo, useEffect, useState, useRef } from 'react'
import { ArrowUpRight, Download, Upload, X, FileText, Image } from 'lucide-react'
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

function getAttachmentName(attachment) {
  return attachment?.filename || attachment?.file_name || attachment?.file || 'Attachment'
}

function getAttachmentSize(attachment) {
  return attachment?.size ?? attachment?.file_size ?? null
}

function getAttachmentUrl(attachment) {
  return attachment?.url || attachment?.download_url || attachment?.file || ''
}

function statusClass(status) {
  switch ((status || '').toLowerCase()) {
    case 'graded':
      return 'bg-emerald-100 text-emerald-700'
    case 'late submission':
      return 'bg-rose-100 text-rose-700'
    case 'submitted':
      return 'bg-sky-100 text-sky-700'
    case 'not submitted':
    default:
      return 'bg-amber-100 text-amber-700'
  }
}

function humanRemaining(due) {
  if (!due) return '—'
  const diff = new Date(due).getTime() - Date.now()
  const minutes = Math.round(Math.abs(diff) / 60000)
  if (diff < 0) {
    if (minutes < 60) return `${minutes}m overdue`
    if (minutes < 1440) return `${Math.round(minutes / 60)}h overdue`
    return `${Math.round(minutes / 1440)}d overdue`
  }
  if (minutes < 60) return `${minutes}m left`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h left`
  return `${Math.round(minutes / 1440)}d left`
}

function statusBadge(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('graded')) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Graded</span>
  if (s.includes('submitted')) return <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">Submitted</span>
  if (s.includes('late') || s.includes('overdue')) return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Overdue</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Not Submitted</span>
}

export default function ActivityDetailModal({ activity, isOpen, onClose, onSubmit }) {
  const [submission, setSubmission] = useState(activity?.submission || null)
  const [loadingSubmission, setLoadingSubmission] = useState(false)
  // Embedded submission form states
  const [files, setFiles] = useState([])
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [comments, setComments] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [successMessage, setSuccessMessage] = useState('')
  const fileInputRef = useRef(null)
  const [toastMessage, setToastMessage] = useState('')

  // Determine status from the authoritative submission record when available
  // Requirement: status must be 'Not Submitted' unless a Submission record exists.
  const submissionStatus = submission ? (submission.graded_at || submission.score != null ? 'Graded' : 'Submitted') : 'Not Submitted'
  const isOpenForSubmission = !activity?.due_date || new Date(activity.due_date) >= new Date()
  const canResubmit = activity?.allow_resubmission && !!submission

  const attachmentRows = useMemo(() => activity?.attachments || [], [activity])

  useEffect(() => {
    setSubmission(activity?.submission || null)
    if (!activity) return
    if (activity?.submission) return
    // fetch submission for this activity for the current user
    let mounted = true
    const fetchSubmission = async () => {
      setLoadingSubmission(true)
      try {
        const res = await api.get(`/submissions/`, { params: { activity: activity.id, page_size: 10 } })
        const results = Array.isArray(res.data) ? res.data : res.data.results || []
        if (!mounted) return
        setSubmission(results[0] || null)
      } catch (err) {
        console.error('Failed to load submission for activity:', err)
      } finally {
        setLoadingSubmission(false)
      }
    }
    fetchSubmission()
    return () => { mounted = false }
  }, [activity])

  // Helpers for upload form
  const isOverdue = activity?.due_date && new Date(activity.due_date) < new Date()
  const canSubmit = !isOverdue || activity?.allow_late_submission

  const handleFileSelect = async (e) => {
    const selectedFiles = Array.from(e.target.files || [])
    if (selectedFiles.length === 0) return

    const newErrors = []
    const validFiles = []
    selectedFiles.forEach((file) => {
      validFiles.push(file)
    })
    if (newErrors.length) {
      setErrors(newErrors)
      return
    }

    setErrors([])
    setUploadProgress(0)
    setLoading(true)
    try {
      const formData = new FormData()
      validFiles.forEach((f) => formData.append('files', f))
      formData.append('activity', activity.id)
      const res = await api.post('/student/submissions/upload', formData, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            setUploadProgress(percent)
          }
        },
      })

      const uploads = res.data.uploads || []
      setUploadedFiles((prev) => [...prev, ...uploads])
      setFiles((prev) => [...prev, ...validFiles])
      setSuccessMessage('Files uploaded as draft.')
      setToastMessage('Draft uploaded')
      try { onSubmit && onSubmit() } catch (e) {}
    } catch (err) {
      setErrors(['Failed to upload files. Please try again.'])
    } finally {
      setLoading(false)
      setUploadProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const dropped = Array.from(e.dataTransfer?.files || [])
    if (dropped.length) {
      const eventLike = { target: { files: dropped } }
      handleFileSelect(eventLike)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleRemoveFile = (index) => {
    const removedLocal = files[index]
    setFiles((prev) => prev.filter((_, i) => i !== index))
    const removedUpload = uploadedFiles[index]
    if (removedUpload && removedUpload.id) {
      api.delete(`/temp-uploads/${removedUpload.id}/`).catch(() => {})
      setUploadedFiles((prev) => prev.filter((u) => u.id !== removedUpload.id))
    }
    setSuccessMessage('Draft removed.')
  }

  const handleSubmit = async (e) => {
    e?.preventDefault()
    setErrors([])
    if (!uploadedFiles || uploadedFiles.length === 0) {
      setErrors(['Please upload at least one file draft before submitting.'])
      return
    }
    if (!confirm('Submit your files? This will create a submission for this activity.')) return
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('activity', activity.id)
      formData.append('remarks', comments)
      uploadedFiles.forEach((u) => formData.append('temp_upload_ids', u.id))

      const res = await api.post('/submissions/', formData)
      // Refresh submission state to show 'Your Work'
      const newSubmissionRes = await api.get(`/submissions/?activity=${activity.id}&page_size=1`)
      const results = Array.isArray(newSubmissionRes.data) ? newSubmissionRes.data : newSubmissionRes.data.results || []
      setSubmission(results[0] || null)
      setFiles([])
      setUploadedFiles([])
      setComments('')
      setSuccessMessage('Submission created successfully.')
      setToastMessage('Submission created successfully.')
      try { onSubmit && onSubmit() } catch (e) {}
    } catch (err) {
      setErrors(['Failed to submit activity. Please try again.'])
    } finally {
      setLoading(false)
      setUploadProgress(0)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Activity Details">
      {!activity ? (
        <p className="text-sm text-slate-600">Activity details are unavailable.</p>
      ) : (
        <div className="space-y-8">
          <section className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3 rounded-[16px] border border-[#E5E7EB] bg-slate-50 p-6">
              <div>
                <p className="text-sm font-semibold text-slate-500">Title</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{activity.title}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">Instructor</p>
                <p className="mt-2 text-slate-900">{activity.instructor_name || 'Unassigned'}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">Assigned Section</p>
                <p className="mt-2 text-slate-900">{activity.section_name || 'Unassigned'}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">Max Score</p>
                <p className="mt-2 text-slate-900">{activity.max_score ?? '—'}</p>
              </div>
            </div>
            <div className="space-y-3 rounded-[16px] border border-[#E5E7EB] bg-slate-50 p-6">
              <div>
                <p className="text-sm font-semibold text-slate-500">Posted Date</p>
                <p className="mt-2 text-slate-900">{formatDate(activity.created_at)}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">Due Date</p>
                <div className="mt-2 flex items-center gap-3">
                  <p className="text-slate-900">{formatDate(activity.due_date)}</p>
                  <div className="text-xs text-slate-400">{humanRemaining(activity.due_date)}</div>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">Status</p>
                <div className="mt-2">{statusBadge(submissionStatus)}</div>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">Submission Date</p>
                <p className="mt-2 text-slate-900">{formatDate(activity.student_submitted_at)}</p>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-[16px] border border-[#E5E7EB] bg-white p-6">
            <h3 className="text-base font-semibold text-slate-900">Description</h3>
            <p className="text-sm leading-7 text-slate-700">{activity.description || 'No description provided.'}</p>
          </section>

          <section className="space-y-4 rounded-[16px] border border-[#E5E7EB] bg-white p-6">
            <h3 className="text-base font-semibold text-slate-900">Instructions</h3>
            <p className="text-sm leading-7 text-slate-700">{activity.instructions || 'No instructions provided.'}</p>
          </section>

          <section className="space-y-4 rounded-[16px] border border-[#E5E7EB] bg-white p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Attachments</h3>
                <p className="text-sm text-slate-500">Download files uploaded by the instructor.</p>
              </div>
              <div className="text-sm text-slate-500">Supported: PDF, DOCX, PPTX, Images, ZIP</div>
            </div>
            {attachmentRows.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-8 text-center text-sm text-slate-600">
                No attachments available.
              </div>
            ) : (
              <div className="space-y-3">
                {attachmentRows.map((attachment) => (
                  <div key={attachment.id} className="flex flex-col gap-2 rounded-[12px] border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{getAttachmentName(attachment)}</p>
                      <p className="text-sm text-slate-500">{formatBytes(getAttachmentSize(attachment))}</p>
                    </div>
                    <a
                      href={getAttachmentUrl(attachment)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      <Download size={16} /> Download
                    </a>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Submission Status</h3>
                <p className="text-sm text-slate-500">Your current activity submission details.</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[12px] bg-[#F8FAFC] p-4">
                <p className="text-sm text-slate-500">Current status</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{loadingSubmission ? 'Loading...' : submissionStatus}</p>
                {submission && <p className="mt-1 text-xs text-slate-500">Submitted: {formatDate(submission.submitted_at || submission.created_at)}</p>}
              </div>
              <div className="rounded-[12px] bg-[#F8FAFC] p-4">
                <p className="text-sm text-slate-500">Score</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{submission?.score ?? activity.student_score ?? '—'}</p>
              </div>
              <div className="rounded-[12px] bg-[#F8FAFC] p-4">
                <p className="text-sm text-slate-500">Instructor feedback</p>
                <p className="mt-2 text-slate-700">{submission?.feedback || activity.student_feedback || 'No feedback yet.'}</p>
              </div>
              <div className="rounded-[12px] bg-[#F8FAFC] p-4">
                <p className="text-sm text-slate-500">Date graded</p>
                <p className="mt-2 text-slate-900">{formatDate(submission?.graded_at || activity.student_graded_at)}</p>
              </div>
            </div>

            <section className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-900">Your Work</h4>
              <div className="rounded-[12px] border border-dashed border-slate-200 p-4">
                {submission ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 text-2xl text-emerald-600">✓</div>
                      <div>
                        <p className="font-medium text-slate-900">Submitted</p>
                        <p className="text-xs text-slate-500">{formatDate(submission.submitted_at || submission.created_at)}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {(submission.attachments || (submission.file ? [{ id: 'f', file: submission.file, file_name: submission.file.split('/').pop(), download_url: submission.file }] : [])).map((att) => (
                        <div key={att.id || att.file_name} className="flex items-center justify-between rounded-md bg-white p-3">
                          <div>
                            <p className="font-medium text-slate-900">{att.file_name || att.file?.split('/').pop()}</p>
                            <p className="text-xs text-slate-500">{formatBytes(att.file_size) || ''} • Uploaded {formatDate(att.uploaded_at || submission.submitted_at || submission.created_at)}</p>
                          </div>
                          <a href={att.download_url || att.file} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-sm font-semibold text-white"> <Download size={14} /> Download</a>
                        </div>
                      ))}
                    </div>

                    {canResubmit && (
                      <div className="mt-3">
                        <p className="text-sm text-slate-600">Resubmission is allowed for this activity. Use the button below to replace your files.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div onDrop={handleDrop} onDragOver={handleDragOver} className="relative rounded-[12px] border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center transition hover:border-blue-400">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        disabled={loading || !canSubmit}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading || !canSubmit}
                        className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-2 font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-400"
                      >
                        <Upload size={18} /> Choose Files
                      </button>
                      <p className="mt-3 text-xs text-slate-500">Supported: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT, ZIP, JPG, JPEG, PNG • Max 20 MB per file</p>
                    </div>

                    {uploadProgress > 0 && (
                      <div className="mt-2">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-slate-500">Uploading: {uploadProgress}%</p>
                      </div>
                    )}

                    {files.length > 0 && (
                      <div className="space-y-2 mt-3">
                        <p className="text-sm font-semibold text-slate-900">{files.length} file(s) selected</p>
                        {files.map((file, index) => {
                          const uploaded = uploadedFiles[index]
                          return (
                            <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center gap-3">
                                {file.type && file.type.startsWith('image/') ? <Image size={20} className="text-slate-400" /> : <FileText size={20} className="text-slate-400" />}
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{uploaded?.name || file.name}</p>
                                  <p className="text-xs text-slate-500">{formatBytes(uploaded?.size || file.size)}</p>
                                  {uploaded ? <p className="text-xs text-emerald-700">✓ Ready to submit</p> : <p className="text-xs text-slate-500">Uploading or pending</p>}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFile(index)}
                                  className="rounded-full p-2 transition hover:bg-red-50"
                                >
                                  <X size={18} className="text-red-600" />
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {successMessage && (
                      <div className="rounded-[12px] border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 mt-3">{successMessage}</div>
                    )}

                    <div className="mt-4">
                      <label className="block">
                        <p className="mb-2 text-sm font-semibold text-slate-900">Comments (Optional)</p>
                        <textarea
                          value={comments}
                          onChange={(e) => setComments(e.target.value)}
                          placeholder="Add any comments or notes about your submission..."
                          disabled={loading}
                          rows={4}
                          className="w-full rounded-[12px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                        />
                      </label>
                    </div>

                    {errors.length > 0 && (
                      <div className="space-y-2 rounded-[12px] border border-red-200 bg-red-50 p-4 mt-3">
                        {errors.map((error, i) => (
                          <p key={i} className="text-sm text-red-700">• {error}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
<div className="flex gap-4 justify-end border-t border-slate-200 pt-6">
+          <div className="flex gap-4 justify-end border-t border-slate-200 pt-6">
+            <button
+              type="button"
+              onClick={onClose}
+              disabled={loading}
+              className="flex-1 rounded-full border border-slate-200 bg-white px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:bg-slate-100"
+            >
+              Cancel
+            </button>
+            <button
+              type="button"
+              onClick={handleSubmit}
+              disabled={loading || !canSubmit || uploadedFiles.length === 0}
+              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-400"
+            >
+              {loading ? 'Submitting...' : (
+                <>
+                  <Upload size={18} /> Submit Activity
+                </>
+              )}
+            </button>
                setSubmission(null)
                  } catch (err) {
                    console.error('Failed to unsubmit:', err)
                    alert('Failed to unsubmit. Try again.')
                  }
                }}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Unsubmit
              </button>
            )}
          </div>

          <div className="flex gap-4 justify-end border-t border-slate-200 pt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded-full border border-slate-200 bg-white px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !canSubmit || uploadedFiles.length === 0}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-400"
            >
              {loading ? 'Submitting...' : (
                <>
                  <Upload size={18} /> Submit Activity
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
