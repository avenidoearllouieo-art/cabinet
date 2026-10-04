import { useEffect, useState } from 'react'
import { BookOpen, CheckCircle2, Download, Eye, FileText, Send, Star, Users } from 'lucide-react'
import api from '../../services/api.js'
import ActivityAnnouncements from '../ActivityAnnouncements.jsx'
import ActivityDiscussion from '../ActivityDiscussion.jsx'
import StatusBadge from '../StatusBadge.jsx'
import { FormActions, FormDialog, FormSection, FormStepper, InlineFeedback } from '../forms/FormPrimitives.jsx'

const detailSteps = ['Activity details', 'Attachments', 'Your submission', 'Discussion']

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
  const value = String(status || 'Not Submitted')
  if (value.toLowerCase().includes('graded')) return <StatusBadge status="graded" label="Graded" />
  if (value.toLowerCase().includes('submitted')) return <StatusBadge status="submitted" label={value} />
  if (value.toLowerCase().includes('late') || value.toLowerCase().includes('overdue')) return <StatusBadge status="late" label={value} />
  return <StatusBadge status="pending" label={value} />
}

export default function ActivityViewModal({ activity: initialActivity, isOpen, onClose, onSubmit, submissionAction = '' }) {
  const [activity, setActivity] = useState(initialActivity || null)
  const [submission, setSubmission] = useState(null)
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!isOpen) return undefined
    let active = true
    const timeoutId = window.setTimeout(async () => {
      setLoading(true)
      setLoadError('')
      setStep(0)
      setActivity(initialActivity || null)
      setSubmission(null)
      if (!initialActivity) {
        setLoading(false)
        return
      }
      const activityId = typeof initialActivity === 'number' ? initialActivity : initialActivity.id
      try {
        const activityResponse = await api.get(`/activities/${activityId}/`)
        if (active) setActivity(activityResponse.data)
      } catch (err) {
        console.error('Failed to load activity details', err)
        if (active) setLoadError('Showing the activity summary. Full details could not be refreshed.')
      }
      try {
        const submissionResponse = await api.get('/submissions/', { params: { activity: activityId, ordering: '-submitted_at', page_size: 1 } })
        const results = Array.isArray(submissionResponse.data) ? submissionResponse.data : submissionResponse.data.results || []
        if (active) setSubmission(results[0] || null)
      } catch (err) {
        console.error('Failed to load submission', err)
      } finally {
        if (active) setLoading(false)
      }
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [initialActivity, isOpen])

  const submissionStatus = activity?.student_submission_status || (submission ? (submission.score != null ? 'Graded' : 'Submitted') : 'Not Submitted')
  const canEditSubmission = submissionAction === 'Submit Activity' || submissionAction === 'Edit Submission'
  const visibleSubmissionStatus = submission?.score != null || submission?.graded_at ? 'Graded' : submissionStatus
  const latestSubmittedAt = submission?.submitted_at || submission?.created_at || activity?.student_submitted_at

  return (
    <FormDialog
      isOpen={isOpen}
      title="Activity Details"
      description={activity?.title || 'Student activity overview'}
      onClose={onClose}
      dirty={false}
      busy={loading}
      asForm={false}
      maxWidth="max-w-5xl"
      stepper={<FormStepper steps={detailSteps} currentStep={step} />}
      actions={(
        <FormActions
          onCancel={onClose}
          onBack={step > 0 ? () => setStep((current) => Math.max(0, current - 1)) : undefined}
          onNext={() => setStep((current) => Math.min(detailSteps.length - 1, current + 1))}
          isLastStep={step === detailSteps.length - 1}
          submitLabel="Close"
          finalButtonType="button"
          onFinalAction={onClose}
          hideCancel
          busy={loading}
        />
      )}
    >
      {!activity ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">Activity details are unavailable.</div>
      ) : (
        <div className="space-y-4">
          {loadError && <InlineFeedback>{loadError}</InlineFeedback>}
          {step === 0 && (
            <>
              <FormSection icon={Users} title={activity.title || 'Activity'} description={activity.activity_type || 'Activity details'}>
                <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <DetailFact label="Instructor" value={activity.instructor_name || 'Not recorded'} />
                  <DetailFact label="Due date" value={formatDate(activity.due_date)} />
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><dt className="text-xs font-semibold text-slate-500">Current status</dt><dd className="mt-2">{statusBadge(visibleSubmissionStatus)}</dd></div>
                  <DetailFact label="Maximum score" value={activity.max_score != null ? `${activity.max_score} pts` : 'Not recorded'} icon={<Star size={15} />} />
                </dl>
              </FormSection>
              <div className="grid gap-4 lg:grid-cols-2">
                <FormSection icon={FileText} title="Description">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{activity.description || 'No description provided.'}</p>
                </FormSection>
                <FormSection icon={BookOpen} title="Instructions">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{activity.instructions || 'No instructions provided.'}</p>
                </FormSection>
              </div>
            </>
          )}

          {step === 1 && (
            <FormSection icon={FileText} title="Attachments" description="Files shared by your instructor.">
              {activity.attachments?.length ? (
                <ul className="space-y-2">
                  {activity.attachments.map((attachment) => (
                    <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="min-w-0"><p className="break-words text-sm font-semibold text-slate-800">{getAttachmentName(attachment)}</p><p className="mt-0.5 text-xs text-slate-500">{formatBytes(getAttachmentSize(attachment))}</p></div>
                      <a href={getAttachmentUrl(attachment)} target="_blank" rel="noreferrer" className="student-table-action student-table-action-primary"><Download size={14} />Download</a>
                    </li>
                  ))}
                </ul>
              ) : <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">No attachments for this activity.</p>}
            </FormSection>
          )}

          {step === 2 && (
            <FormSection icon={CheckCircle2} title="Your Submission" description="Latest submission, notes, files, and feedback.">
              <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Status</dt><dd className="mt-2">{statusBadge(visibleSubmissionStatus)}</dd></div>
                <DetailFact label="Submitted" value={latestSubmittedAt ? formatDate(latestSubmittedAt) : 'Not submitted'} />
                <DetailFact label="Score" value={submission?.score != null ? `${submission.score}${activity.max_score != null ? ` / ${activity.max_score}` : ''}` : 'Not graded'} />
                <DetailFact label="Date graded" value={submission?.graded_at ? formatDate(submission.graded_at) : 'Not recorded'} />
              </dl>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h4 className="text-sm font-semibold text-[#102a4c]">Submission notes</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{submission?.remarks || 'No notes were added.'}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h4 className="text-sm font-semibold text-[#102a4c]">Instructor feedback</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{submission?.feedback || activity.student_feedback || 'No feedback yet.'}</p>
                </div>
              </div>

              <div className="mt-4">
                <h4 className="mb-2 text-sm font-semibold text-[#102a4c]">Submitted files</h4>
                {submission?.files?.length ? (
                  <ul className="space-y-2">
                    {submission.files.map((file) => <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"><span className="break-words text-sm font-medium text-slate-700">{file.name || file.filename || 'Attachment'} <span className="text-xs text-slate-500">· {formatBytes(getAttachmentSize(file))}</span></span><a href={getAttachmentUrl(file)} target="_blank" rel="noreferrer" className="student-table-action"><Download size={14} />Download</a></li>)}
                  </ul>
                ) : <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">No files attached to the latest submission.</p>}
              </div>

              {submission?.previous_attempts?.length > 0 && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h4 className="text-sm font-semibold text-[#102a4c]">Previous versions</h4>
                  <ul className="mt-2 divide-y divide-slate-200 text-sm text-slate-600">
                    {submission.previous_attempts.map((attempt) => <li key={attempt.id} className="flex justify-between gap-3 py-2"><span>Attempt {attempt.attempt || 1}</span><span>{formatDate(attempt.submitted_at)}</span></li>)}
                  </ul>
                </div>
              )}

              {submissionAction && (
                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={() => onSubmit?.(activity)} disabled={loading} className={canEditSubmission ? 'student-table-action student-table-action-primary min-h-11 px-4' : 'student-table-action min-h-11 px-4'}>
                    {canEditSubmission ? <Send size={15} /> : <Eye size={15} />}{submissionAction}
                  </button>
                </div>
              )}
            </FormSection>
          )}

          {step === 3 && (
            <FormSection icon={Send} title="Discussion" description="Announcements and messages for this activity.">
              <div className="space-y-4">
                <ActivityAnnouncements activityId={activity.id} />
                <ActivityDiscussion activityId={activity.id} />
              </div>
            </FormSection>
          )}
        </div>
      )}
    </FormDialog>
  )
}

function DetailFact({ label, value, icon }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <dt className="flex items-center gap-2 text-xs font-medium text-slate-500">{icon}{label}</dt>
      <dd className="mt-2 break-words text-sm font-semibold text-[#102a4c]">{value}</dd>
    </div>
  )
}
