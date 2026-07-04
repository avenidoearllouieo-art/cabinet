import { useMemo } from 'react'
import { ArrowUpRight, Download } from 'lucide-react'
import Modal from '../Modal.jsx'

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

export default function ActivityDetailModal({ activity, isOpen, onClose, onSubmit }) {
  const submissionStatus = activity?.student_submission_status || 'Not Submitted'
  const isOpenForSubmission = !activity?.due_date || new Date(activity.due_date) >= new Date()
  const canResubmit = activity?.allow_resubmission && submissionStatus !== 'Not Submitted' && submissionStatus !== 'Graded'

  const attachmentRows = useMemo(() => activity?.attachments || [], [activity])

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
                <p className="mt-2 text-slate-900">{formatDate(activity.due_date)}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500">Status</p>
                <div className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusClass(submissionStatus)}`}>
                  {submissionStatus}
                </div>
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
                      <p className="font-medium text-slate-900">{attachment.file_name}</p>
                      <p className="text-sm text-slate-500">{formatBytes(attachment.file_size)}</p>
                    </div>
                    <a
                      href={attachment.download_url}
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
                <p className="mt-2 text-lg font-semibold text-slate-900">{submissionStatus}</p>
              </div>
              <div className="rounded-[12px] bg-[#F8FAFC] p-4">
                <p className="text-sm text-slate-500">Score</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{activity.student_score ?? '—'}</p>
              </div>
              <div className="rounded-[12px] bg-[#F8FAFC] p-4">
                <p className="text-sm text-slate-500">Instructor feedback</p>
                <p className="mt-2 text-slate-700">{activity.student_feedback || 'No feedback yet.'}</p>
              </div>
              <div className="rounded-[12px] bg-[#F8FAFC] p-4">
                <p className="text-sm text-slate-500">Date graded</p>
                <p className="mt-2 text-slate-900">{formatDate(activity.student_graded_at)}</p>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Close
            </button>
            {submissionStatus === 'Not Submitted' && isOpenForSubmission && (
              <button
                type="button"
                onClick={() => onSubmit(activity)}
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                <ArrowUpRight size={16} className="mr-2" /> Submit Activity
              </button>
            )}
            {canResubmit && (
              <button
                type="button"
                onClick={() => onSubmit(activity)}
                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                <ArrowUpRight size={16} className="mr-2" /> Resubmit
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
