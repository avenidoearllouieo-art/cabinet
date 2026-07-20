import { useEffect, useMemo, useState } from 'react'
import Modal from '../Modal.jsx'
import api from '../../services/api.js'

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch (err) {
    return String(value)
  }
}

const resolveActivityType = (submission) => {
  if (!submission) return '—'
  return (
    submission.activity_type ||
    submission.activity?.activity_type ||
    submission.activity?.type ||
    '—'
  )
}

const resolveStatus = (submission) => {
  if (!submission) return 'Unknown'
  const raw = submission.status ? String(submission.status).toLowerCase() : null
  if (raw === 'graded') return 'Graded'
  if (raw === 'late') return 'Late'
  if (raw === 'submitted') return 'Submitted'
  if (raw === 'pending') return 'Pending'

  if (submission.score != null) return 'Graded'
  if (submission.file || submission.submitted_at) return 'Submitted'
  return 'Pending'
}

const buildFileUrl = (filePath) => {
  if (!filePath) return null
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath
  return `${window.location.origin}${filePath}`
}

export default function ViewSubmissionModal({ isOpen, submissionId, submission, onClose, onUnauthorized }) {
  const [details, setDetails] = useState(submission || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setError('')

    if (submission) {
      setDetails(submission)
      setLoading(false)
      return
    }

    if (submissionId) {
      setDetails(null)
      fetchSubmission(submissionId)
      return
    }

    setDetails(null)
  }, [isOpen, submissionId, submission])

  const fetchSubmission = async (id) => {
    setLoading(true)
    try {
      const response = await api.get(`/submissions/${id}/`)
      setDetails(response.data)
      setError('')
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized && onUnauthorized()
      } else {
        console.error('Error loading submission details:', err)
        setError('Failed to load submission details.')
      }
    } finally {
      setLoading(false)
    }
  }

  const fileUrl = useMemo(() => buildFileUrl(details?.file), [details])
  const fileName = useMemo(() => {
    if (!details?.file) return ''
    const parts = details.file.split('/')
    return parts[parts.length - 1]
  }, [details])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Submission Details">
      {loading ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] shadow-sm">Loading submission details...</div>
      ) : !details ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] shadow-sm">
          <p className="text-lg font-semibold">No submission yet.</p>
          <p className="text-sm text-slate-500">You have not submitted for this activity.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Activity Information */}
          <div className="rounded-[12px] border p-4 bg-white">
            <h3 className="text-lg font-semibold">{details?.activity_title || details?.activity?.title || 'Activity'}</h3>
            <div className="mt-2 text-sm text-slate-700">{details?.activity_description || details?.activity?.description || 'No description provided.'}</div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-slate-600">
              <div><strong>Instructor:</strong> {details?.instructor_name || details?.activity?.created_by_name || '—'}</div>
              <div><strong>Due Date:</strong> {formatDate(details?.activity?.due_date)}</div>
              <div><strong>Max Score:</strong> {details?.activity_max_score ?? details?.activity?.max_score ?? '—'}</div>
            </div>
          </div>

          {/* Activity Attachments */}
          { (details?.activity && details.activity.attachments && details.activity.attachments.length) || (details?.activity_attachments && details.activity_attachments.length) ? (
            <div className="rounded-[12px] border p-4 bg-white">
              <h4 className="font-semibold">Activity Attachments</h4>
              <div className="mt-3 space-y-2">
                {(details.activity?.attachments || details.activity_attachments || []).map((att) => (
                  <div key={att.id || att.file} className="flex items-center justify-between rounded bg-slate-50 p-2">
                    <div>
                      <div className="font-medium">{att.filename || att.file_name || att.name}</div>
                      <div className="text-xs text-slate-500">{att.file_size ? `${(att.file_size/1024).toFixed(1)} KB` : ''}</div>
                    </div>
                    <a href={att.url || att.download_url || att.file} target="_blank" rel="noreferrer" className="rounded-full bg-slate-900 px-3 py-1 text-white text-sm">Download</a>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* My Submission */}
          <div className="rounded-[12px] border p-4 bg-white">
            <h4 className="font-semibold">My Submission</h4>
            { !details?.submitted_at && !(details?.files && details.files.length) ? (
              <div className="mt-4 text-center">
                <p className="text-sm text-slate-600">No submission yet.</p>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="text-sm text-slate-700">Submitted: {formatDate(details?.submitted_at)}</div>
                {details?.remarks && (
                  <div>
                    <p className="text-sm font-medium text-slate-700">Comments</p>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">{details.remarks}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium text-slate-700">Files</p>
                  { (details.files && details.files.length) ? (
                    <div className="mt-2 space-y-2">
                      {details.files.map((f) => (
                        <div key={f.id || f.url} className="flex items-center justify-between rounded-md bg-white p-3 border">
                          <div>
                            <div className="font-medium text-slate-900">{f.name || f.file_name}</div>
                            <div className="text-xs text-slate-500">{f.size ? `${(f.size/1024).toFixed(1)} KB` : ''} • Uploaded {formatDate(f.uploaded_at || details.submitted_at)}</div>
                          </div>
                          <a href={f.url || f.download_url || f.file} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-sm font-semibold text-white">Download</a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">No submitted files available.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Grading */}
          <div className="rounded-[12px] border p-4 bg-white">
            <h4 className="font-semibold">Grading</h4>
            { details?.score != null ? (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-600">Score</p>
                  <p className="text-lg font-semibold">{details.score} / {details.activity_max_score ?? details.activity?.max_score ?? '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Percentage</p>
                  <p className="text-lg font-semibold">{details.activity_max_score ? `${Math.round((details.score / details.activity_max_score) * 100)}%` : '—'}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-sm text-slate-600">Instructor Feedback</p>
                  <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{details.feedback || 'No feedback provided.'}</p>
                  <p className="mt-2 text-xs text-slate-500">Graded: {formatDate(details.graded_at)}</p>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-600">Waiting for instructor grading.</div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-[#F3F4F6] px-4 py-2 text-sm font-semibold text-[#111827] transition hover:bg-[#E5E7EB]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
