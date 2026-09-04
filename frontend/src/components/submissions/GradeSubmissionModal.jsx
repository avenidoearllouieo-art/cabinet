import { useEffect, useState } from 'react'
import { MessageSquareText, Trophy, UserRound } from 'lucide-react'
import api from '../../services/api.js'
import { controlClass } from '../forms/formStyles.js'
import { FormActions, FormDialog, FormField, FormSection, InlineFeedback } from '../forms/FormPrimitives.jsx'

export default function GradeSubmissionModal({ isOpen, submission, onClose, onUnauthorized, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({ score: '', feedback: '' })
  const [initialForm, setInitialForm] = useState({ score: '', feedback: '' })

  useEffect(() => {
    if (!isOpen || !submission) return
    const timeoutId = window.setTimeout(() => {
      const loaded = { score: submission.score !== null && submission.score !== undefined ? String(submission.score) : '', feedback: submission.feedback || '' }
      setErrors({})
      setFormError('')
      setForm(loaded)
      setInitialForm(loaded)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, submission])

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    if (!submission?.id) return setFormError('Missing submission ID.')
    const numericScore = Number(String(form.score).trim())
    const maxScore = Number(submission.max_score ?? submission.activity_max_score)
    if (!String(form.score).trim() || Number.isNaN(numericScore)) return setErrors({ score: 'Enter a valid numeric score.' })
    if (numericScore < 0) return setErrors({ score: 'Score cannot be below zero.' })
    if (Number.isFinite(maxScore) && numericScore > maxScore) return setErrors({ score: `Score cannot exceed ${maxScore}.` })

    setSaving(true)
    setErrors({})
    setFormError('')
    try {
      const response = await api.post(`/submissions/${submission.id}/grade/`, { score: numericScore, feedback: form.feedback || '' })
      onSaved?.(response.data)
      onClose?.()
    } catch (error) {
      if (error.response?.status === 401) return onUnauthorized?.()
      const data = error.response?.data
      if (typeof data === 'string') setFormError(data)
      else if (data && typeof data === 'object') {
        setErrors(data)
        setFormError(typeof data.detail === 'string' ? data.detail : 'Review the highlighted fields and try again.')
      } else setFormError('Failed to save the grade. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!submission) return null
  const studentName = `${submission.student_name || ''} ${submission.student_last_name || ''}`.trim() || submission.student_username || 'Unknown student'
  const activityTitle = submission.activity_title || 'Unknown activity'
  const maxScore = submission.max_score ?? submission.activity_max_score
  const isEditing = submission.score !== null && submission.score !== undefined

  return (
    <FormDialog
      isOpen={isOpen}
      title={isEditing ? 'Edit Grade' : 'Grade Submission'}
      description="Review the student and provide a clear score with constructive feedback."
      onClose={onClose}
      onSubmit={handleSubmit}
      dirty={JSON.stringify(form) !== JSON.stringify(initialForm)}
      busy={saving}
      maxWidth="max-w-2xl"
      actions={<FormActions onCancel={onClose} isLastStep submitLabel={isEditing ? 'Update grade' : 'Save grade'} busy={saving} dirty={JSON.stringify(form) !== JSON.stringify(initialForm)} />}
    >
      <div className="space-y-4">
        <InlineFeedback>{formError}</InlineFeedback>
        <section className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-900"><UserRound className="h-6 w-6" /></div>
          <div className="min-w-0"><p className="truncate text-base font-bold text-[#0B1F3A]">{studentName}</p><p className="truncate text-sm text-slate-500">{activityTitle}</p><p className="mt-1 text-xs text-slate-500">Submitted {submission.submitted_at ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(submission.submitted_at)) : 'date unavailable'}</p></div>
        </section>
        <FormSection icon={Trophy} title="Score" description={Number.isFinite(Number(maxScore)) ? `Grade this work out of ${maxScore} points.` : 'Enter the score awarded for this work.'}>
          <FormField label="Score awarded" required error={errors.score}>
            {({ id, describedBy, invalid }) => <div className="flex items-stretch"><input id={id} type="number" step="0.01" min="0" max={Number.isFinite(Number(maxScore)) ? maxScore : undefined} value={form.score} onChange={update('score')} placeholder="0" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid, 'rounded-r-none text-2xl font-bold')} /><span className="flex min-w-20 items-center justify-center rounded-r-xl border border-l-0 border-slate-300 bg-slate-50 px-4 text-sm font-bold text-slate-600">/ {Number.isFinite(Number(maxScore)) ? maxScore : '—'}</span></div>}
          </FormField>
        </FormSection>
        <FormSection icon={MessageSquareText} title="Student feedback" description="Explain what went well and what the student can improve.">
          <FormField label="Feedback" optional error={errors.feedback}>{({ id, describedBy, invalid }) => <textarea id={id} value={form.feedback} onChange={update('feedback')} rows={6} placeholder="Provide specific, constructive feedback…" aria-describedby={describedBy} aria-invalid={invalid} className={controlClass(invalid, 'resize-y')} />}</FormField>
        </FormSection>
      </div>
    </FormDialog>
  )
}
