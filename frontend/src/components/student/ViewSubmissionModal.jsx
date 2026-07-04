import { useMemo } from 'react'
import { Download, RotateCcw } from 'lucide-react'
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

function statusBadge(status) {
  const styles = {
    draft: 'bg-gray-100 text-gray-700',
    submitted: 'bg-blue-100 text-blue-700',
    late: 'bg-orange-100 text-orange-700',
    graded: 'bg-green-100 text-green-700',
  }
  return styles[status?.toLowerCase()] || 'bg-gray-100 text-gray-700'
}

export default function ViewSubmissionModal({ submission, isOpen, onClose, onResubmit }) {
  const isGraded = submission?.score != null
  const canResubmit = submission?.activity?.allow_resubmission && new Date(submission?.activity?.due_date) >= new Date()

  const files = useMemo(
    () =>
      submission?.files || [
        {
          id: 1,
          name: submission?.file?.split('/').pop() || 'Submission File',
          size: 1024 * 50,
          url: submission?.file,
        },
      ],
    [submission],
  )

  if (!submission) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Submission Details">
      <div className="space-y-8">
        {/* Activity Information */}
        <section className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3 rounded-[16px] border border-[#E5E7EB] bg-slate-50 p-6">
            <div>
              <p className="text-sm font-semibold text-slate-500">Activity Title</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{submission.activity_title}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-500">Instructor</p>
              <p className="mt-2 text-slate-900">{submission.instructor_name || 'Unassigned'}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-500">Maximum Score</p>
              <p className="mt-2 text-slate-900">{submission.max_score || '—'}</p>
            </div>
          </div>
          <div className="space-y-3 rounded-[16px] border border-[#E5E7EB] bg-slate-50 p-6">
            <div>
              <p className="text-sm font-semibold text-slate-500">Due Date</p>
              <p className="mt-2 text-slate-900">{formatDate(submission.due_date)}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-500">Submission Date</p>
              <p className="mt-2 text-slate-900">{formatDate(submission.submitted_at)}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-500">Status</p>
              <div className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusBadge(submission.submission_status)}`}>
                {submission.submission_status}
              </div>
            </div>
          </div>
        </section>

        {/* Description */}
        {submission.description && (
          <section className="space-y-4 rounded-[16px] border border-[#E5E7EB] bg-white p-6">
            <h3 className="text-base font-semibold text-slate-900">Description</h3>
            <p className="text-sm leading-7 text-slate-700">{submission.description}</p>
          </section>
        )}

        {/* Submitted Files */}
        <section className="space-y-4 rounded-[16px] border border-[#E5E7EB] bg-white p-6">
          <h3 className="text-base font-semibold text-slate-900">Submitted Files</h3>
          {files && files.length > 0 ? (
            <div className="space-y-2">
              {files.map((file) => (
                <div key={file.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">{file.name}</p>
                    <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
                  </div>
                  {file.url && (
                    <a
                      href={file.url}
                      download
                      className="ml-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <Download size={16} /> Download
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No files submitted</p>
          )}
        </section>

        {/* Student Comments */}
        {submission.remarks && (
          <section className="space-y-4 rounded-[16px] border border-[#E5E7EB] bg-white p-6">
            <h3 className="text-base font-semibold text-slate-900">Your Comments</h3>
            <p className="text-sm leading-7 text-slate-700">{submission.remarks}</p>
          </section>
        )}

        {/* Grading Information */}
        {isGraded && (
          <>
            <section className="space-y-4 rounded-[16px] border border-[#E5E7EB] bg-green-50 p-6">
              <h3 className="text-base font-semibold text-slate-900">Score</h3>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold text-green-700">{submission.score}</span>
                <span className="text-lg text-slate-600">/ {submission.max_score || 100}</span>
              </div>
            </section>

            {submission.feedback && (
              <section className="space-y-4 rounded-[16px] border border-[#E5E7EB] bg-white p-6">
                <h3 className="text-base font-semibold text-slate-900">Instructor Feedback</h3>
                <p className="text-sm leading-7 text-slate-700">{submission.feedback}</p>
              </section>
            )}

            {submission.graded_at && (
              <div className="text-xs text-slate-500">
                Graded on {formatDate(submission.graded_at)}
              </div>
            )}
          </>
        )}

        {/* Resubmit Button */}
        {canResubmit && (
          <div className="flex gap-4 border-t border-slate-200 pt-6">
            <button
              type="button"
              onClick={() => onResubmit(submission.activity)}
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
            >
              <RotateCcw size={18} /> Resubmit Activity
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
