import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import Modal from '../Modal.jsx'
import api from '../../services/api.js'

const formatDate = (value) => {
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

const resolveStatus = (submission) => {
  if (!submission) return 'Unknown'
  const raw = submission.status ? String(submission.status).toLowerCase() : null
  const feedback = submission.feedback || submission.remarks
  const score = submission.score ?? submission.grade
  const hasFeedback = Boolean(feedback && String(feedback).trim())
  const isLate = raw === 'late' || submission.is_late || submission.late || (submission.submitted_at && submission.activity_due_date && new Date(submission.submitted_at) > new Date(submission.activity_due_date))

  if (score != null) return 'Graded'
  if (hasFeedback) return 'Returned for Revision'
  if (isLate) return 'Late'
  if (raw === 'graded') return 'Graded'
  if (raw === 'returned_for_revision') return 'Returned for Revision'
  if (raw === 'late') return 'Late'
  if (raw === 'submitted' || raw === 'under_review' || raw === 'pending') return 'Under Review'
  if (submission.file || submission.submitted_at || submission.files?.length) return 'Submitted'
  return 'Pending'
}

export default function ViewSubmissionModal({ isOpen, submissionId, submission, onClose, onUnauthorized }) {
  const [details, setDetails] = useState(submission || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchSubmission = useCallback(async (id) => {
    setLoading(true)
    try {
      const response = await api.get(`/submissions/${id}/`)
      setDetails(response.data)
      setError('')
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized?.()
      } else {
        console.error('Error loading submission details:', err)
        setError('Failed to load submission details.')
      }
    } finally {
      setLoading(false)
    }
  }, [onUnauthorized])

  useEffect(() => {
    if (!isOpen) return
    const timeoutId = window.setTimeout(() => {
      setError('')
      if (submission) {
        setDetails(submission)
        setLoading(false)
      } else if (submissionId) {
        setDetails(null)
        fetchSubmission(submissionId)
      } else {
        setDetails(null)
      }
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, submissionId, submission, fetchSubmission])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Submission History">
      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {loading ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] shadow-sm">Loading submission details...</div>
      ) : !details ? (
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] shadow-sm">
          <p className="text-lg font-semibold">No submission yet.</p>
          <p className="text-sm text-slate-500">You have not submitted for this activity.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-[12px] border-2 border-[#002B5B]/15 bg-white p-5 leading-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{details?.activity_title || details?.activity?.title || 'Activity'}</h3>
                <div className="mt-2 text-sm text-slate-700">{details?.activity_description || details?.activity?.description || 'No description provided.'}</div>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-[#334155]">Read-only</span>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 text-sm text-[#334155] md:grid-cols-3">
              <div><strong>Instructor:</strong> {details?.instructor_name || details?.activity?.created_by_name || '—'}</div>
              <div><strong>Submission Status:</strong> {resolveStatus(details)}</div>
              <div><strong>Submitted:</strong> {formatDate(details?.submitted_at)}</div>
            </div>
          </div>

          {/* Activity Attachments */}
          { (details?.activity && details.activity.attachments && details.activity.attachments.length) || (details?.activity_attachments && details.activity_attachments.length) ? (
            <div className="rounded-[12px] border-2 border-[#002B5B]/15 bg-white p-5 leading-6">
              <h4 className="font-semibold text-[#002B5B]">Activity Attachments</h4>
              <div className="mt-4 space-y-3">
                {(details.activity?.attachments || details.activity_attachments || []).map((att) => (
                  <div key={att.id || att.file} className="flex items-center justify-between rounded border border-[#002B5B]/15 bg-slate-50 p-3">
                    <div>
                      <div className="font-medium">{att.filename || att.file_name || att.name}</div>
                      <div className="text-xs text-slate-500">{att.file_size ? `${(att.file_size/1024).toFixed(1)} KB` : ''}</div>
                    </div>
                    <a href={att.url || att.download_url || att.file} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full !bg-[#002B5B] px-3 py-2 text-sm font-semibold !text-white transition hover:!bg-[#001F42]"><Download size={14} />Download</a>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-[12px] border-2 border-[#002B5B]/15 bg-white p-5 leading-6">
            <h4 className="font-semibold text-[#002B5B]">Submitted Files</h4>
            { !details?.submitted_at && !(details?.files && details.files.length) ? (
              <div className="mt-4 text-center">
                <p className="text-sm text-slate-600">No submission yet.</p>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {details?.remarks && (
                  <div>
                    <p className="text-sm font-medium text-slate-700">Comments</p>
                    <p className="text-sm leading-6 text-[#334155] whitespace-pre-wrap">{details.remarks}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium text-slate-700">Files</p>
                  { (details.files && details.files.length) ? (
                    <div className="mt-3 space-y-3">
                      {details.files.map((f) => (
                        <div key={f.id || f.url} className="flex items-center justify-between rounded-md border border-[#002B5B]/15 bg-white p-4">
                          <div>
                            <div className="font-medium text-slate-900">{f.name || f.file_name}</div>
                            <div className="text-xs text-slate-500">{f.size ? `${(f.size/1024).toFixed(1)} KB` : ''} • Uploaded {formatDate(f.uploaded_at || details.submitted_at)}</div>
                          </div>
                          <a href={f.url || f.download_url || f.file} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full !bg-[#002B5B] px-3 py-2 text-sm font-semibold !text-white transition hover:!bg-[#001F42]"><Download size={14} />Download</a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-[#334155]">No submitted files available.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {details?.previous_attempts?.length ? (
            <div className="rounded-[12px] border-2 border-[#002B5B]/15 bg-white p-5 leading-6">
              <h4 className="font-semibold text-[#002B5B]">Submission History</h4>
              <div className="mt-4 space-y-3">
                {details.previous_attempts.map((attempt) => (
                  <div key={attempt.id} className="flex items-center justify-between rounded-md border border-[#002B5B]/15 bg-slate-50 px-4 py-3 text-sm text-[#334155]">
                    <span>Attempt {attempt.attempt || 1}</span>
                    <span>{formatDate(attempt.submitted_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-[12px] border-2 border-[#002B5B]/15 bg-white p-5 leading-6">
            <h4 className="font-semibold text-[#002B5B]">Instructor Feedback & Grade</h4>
            { details?.score != null ? (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-[#334155]">Score</p>
                  <p className="text-lg font-semibold">{details.score} / {details.activity_max_score ?? details.activity?.max_score ?? '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-[#334155]">Percentage</p>
                  <p className="text-lg font-semibold">{details.activity_max_score ? `${Math.round((details.score / details.activity_max_score) * 100)}%` : '—'}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-sm text-[#334155]">Instructor Feedback</p>
                  <p className="mt-1 text-sm leading-6 text-[#334155] whitespace-pre-wrap">{details.feedback || 'No feedback provided.'}</p>
                  <p className="mt-2 text-xs text-[#475569]">Graded: {formatDate(details.graded_at)}</p>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-[#334155]">Waiting for instructor grading.</div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[#002B5B] bg-white px-4 py-2 text-sm font-semibold text-[#002B5B] transition hover:bg-[#002B5B]/5"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
