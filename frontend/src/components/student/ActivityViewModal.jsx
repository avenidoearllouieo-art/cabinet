import { useEffect, useState } from 'react'
import { Download, Image, FileText } from 'lucide-react'
import Modal from '../Modal.jsx'
import api from '../../services/api.js'
import ActivityAnnouncements from '../ActivityAnnouncements.jsx'
import ActivityDiscussion from '../ActivityDiscussion'

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

function statusBadge(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('graded')) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Graded</span>
  if (s.includes('submitted')) return <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">Submitted</span>
  if (s.includes('late') || s.includes('overdue')) return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Overdue</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Not Submitted</span>
}

export default function ActivityViewModal({ activity: initialActivity, isOpen, onClose, onRefresh }) {
  const [activity, setActivity] = useState(initialActivity || null)
  const [submission, setSubmission] = useState(null)

  useEffect(() => {
    setActivity(initialActivity || null)
    setSubmission(null)

    if (!initialActivity) return

    if (typeof initialActivity === 'number' || (initialActivity && !initialActivity.attachments)) {
      ;(async () => {
        try {
          const res = await api.get(`/activities/${initialActivity.id || initialActivity}/`)
          setActivity(res.data)
        } catch (err) {
          console.error('Failed to load activity', err)
        }
      })()
    }

    const aid = initialActivity.id || initialActivity
    fetchSubmission(aid)
  }, [initialActivity, isOpen])

  const fetchSubmission = async (activityId) => {
    if (!activityId) return
    try {
      const res = await api.get('/submissions/', { params: { activity: activityId, page_size: 1 } })
      const results = Array.isArray(res.data) ? res.data : res.data.results || []
      setSubmission(results[0] || null)
    } catch (err) {
      console.error('Failed to load submission', err)
    }
  }

  const submissionStatus = activity?.student_submission_status || (submission ? (submission.score != null ? 'Graded' : 'Submitted') : 'Not Submitted')

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="View Activity">
      {!activity ? (
        <p className="text-sm text-slate-600">Activity details are unavailable.</p>
      ) : (
        <div className="space-y-6">
          <section className="rounded-[16px] border border-[#E5E7EB] bg-slate-50 p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{activity.title}</h2>
                <p className="text-sm text-slate-500">{activity.activity_type || 'Assignment'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{activity.section_name || 'Section unknown'}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{formatDate(activity.due_date)}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{activity.max_score != null ? `${activity.max_score} pts` : 'Points N/A'}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{statusBadge(submissionStatus)}</span>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-6">
              <h3 className="text-base font-semibold text-slate-900">Description</h3>
              <p className="mt-3 text-sm leading-7 text-slate-700 whitespace-pre-wrap">{activity.description || 'No description provided.'}</p>
            </div>
            <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-6">
              <h3 className="text-base font-semibold text-slate-900">Instructions</h3>
              <p className="mt-3 text-sm leading-7 text-slate-700 whitespace-pre-wrap">{activity.instructions || 'No instructions provided.'}</p>
            </div>
          </section>

          <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Attachments</h3>
                <p className="text-sm text-slate-500">Download files shared by your instructor.</p>
              </div>
            </div>
            {activity.attachments?.length ? (
              <div className="mt-4 space-y-3">
                {activity.attachments.map((attachment) => (
                  <div key={attachment.id} className="flex flex-col gap-3 rounded-[12px] border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{getAttachmentName(attachment)}</p>
                      <p className="text-sm text-slate-500">{formatBytes(getAttachmentSize(attachment))}</p>
                    </div>
                    <a href={getAttachmentUrl(attachment)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
                      <Download size={16} /> Download
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-6 text-sm text-slate-600">No attachments available.</div>
            )}
          </section>

          <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Your Submission</h3>
                <p className="text-sm text-slate-500">Latest saved files, notes, and submission details.</p>
              </div>
            </div>
            {submission ? (
              <div className="space-y-4">
                <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <span className="font-semibold text-slate-900">Status:</span> {submission.score != null || submission.graded_at ? 'Graded' : submissionStatus}
                    <span className="text-slate-400">•</span>
                    <span className="font-semibold text-slate-900">Submitted:</span> {formatDate(submission.submitted_at)}
                    {(submission.score != null || submission.graded_at) ? <><span className="text-slate-400">•</span><span className="font-semibold text-slate-900">Grade:</span> {submission.score ?? '—'}{activity.max_score != null && submission.score != null ? ` / ${activity.max_score}` : ''}</> : null}
                  </div>
                  {submission.remarks ? <p className="mt-3 whitespace-pre-wrap">{submission.remarks}</p> : <p className="mt-3 text-slate-500">No notes were added.</p>}
                </div>
                {submission.files?.length ? (
                  <div className="space-y-3">
                    {submission.files.map((file) => (
                      <div key={file.id} className="flex flex-col gap-2 rounded-[12px] border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-slate-900">{file.name || file.filename || 'Attachment'}</p>
                          <p className="text-sm text-slate-500">{formatBytes(getAttachmentSize(file))}</p>
                        </div>
                        <a href={getAttachmentUrl(file)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
                          <Download size={16} /> Download
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-6 text-sm text-slate-600">No files attached to the latest submission.</div>
                )}
                {submission.previous_attempts?.length ? (
                  <div className="rounded-[12px] border border-slate-200 bg-white p-4">
                    <h4 className="text-sm font-semibold text-slate-900">Previous versions</h4>
                    <ul className="mt-3 space-y-2 text-sm text-slate-600">
                      {submission.previous_attempts.map((attempt) => (
                        <li key={attempt.id} className="flex items-center justify-between rounded-[10px] bg-slate-50 px-3 py-2">
                          <span>Attempt {attempt.attempt || 1}</span>
                          <span>{formatDate(attempt.submitted_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-6 text-sm text-slate-600">No submission has been saved for this activity yet.</div>
            )}
          </section>

          <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Instructor Feedback</h3>
                <p className="text-sm text-slate-500">If graded, your instructor's feedback appears here.</p>
              </div>
            </div>
            <div className="rounded-[12px] bg-slate-50 p-4 text-sm text-slate-700">
              {submission?.feedback || activity.student_feedback || 'No feedback yet.'}
            </div>
          </section>

          <ActivityAnnouncements activityId={activity?.id} />
          <ActivityDiscussion activityId={activity?.id} />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
