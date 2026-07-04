import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../services/api.js'

export default function GradeSubmissionModal({ isOpen, submission, onClose, onUnauthorized, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    score: '',
    feedback: '',
  })

  useEffect(() => {
    if (!isOpen || !submission) return
    
    setErrors({})
    setFormError('')
    setForm({
      score: submission.score !== null ? String(submission.score) : '',
      feedback: submission.feedback || '',
    })
  }, [isOpen, submission])

  const handleChange = (key) => (e) => {
    const value = e && e.target ? e.target.value : e
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((errs) => ({ ...errs, [key]: undefined }))
    setFormError('')
  }

  const handleSubmit = async (e) => {
    e && e.preventDefault && e.preventDefault()
    setSaving(true)
    setErrors({})
    setFormError('')

    if (!submission || !submission.id) {
      setFormError('Missing submission ID.')
      setSaving(false)
      return
    }

    if (!form.score || form.score === '') {
      setErrors({ score: 'Score is required.' })
      setSaving(false)
      return
    }

    const payload = {
      score: form.score,
      feedback: form.feedback || '',
    }

    try {
      const res = await api.post(`/submissions/${submission.id}/grade/`, payload)
      onSaved && onSaved(res.data)
      onClose && onClose()
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized && onUnauthorized()
        return
      }

      const data = err.response?.data
      if (data && typeof data === 'object') {
        if (typeof data.detail === 'string') {
          setFormError(data.detail)
        } else {
          setErrors(data)
          setFormError('Failed to save grade. Please check your input.')
        }
      } else {
        setFormError('Failed to save grade. Please try again.')
        console.error('Failed to grade submission', err)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !submission) return null

  const studentName = `${submission.student_name || ''} ${submission.student_last_name || ''}`.trim() || 'Unknown'
  const activityTitle = submission.activity_title || 'Unknown Activity'
  const isEditing = submission.score !== null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label="Grade Submission">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">
              {isEditing ? 'Edit Grade' : 'Grade Submission'}
            </h2>
            <p className="mt-1 text-sm text-[#6B7280]">
              {isEditing ? 'Update the grade and feedback.' : 'Enter a score and provide feedback for the student.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-xl font-bold text-[#475569] transition hover:text-[#0F172A]" aria-label="Close modal">
            ×
          </button>
        </div>

        {formError && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </div>
        )}

        <div className="mb-6 space-y-3 rounded-lg bg-slate-50 p-4">
          <div>
            <p className="text-xs font-medium text-slate-600 uppercase">Student</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{studentName}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-600 uppercase">Activity</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{activityTitle}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-600 uppercase">Submitted</p>
            <p className="mt-1 text-sm text-slate-900">
              {submission.submitted_at 
                ? new Intl.DateTimeFormat('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(submission.submitted_at))
                : '—'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Score *</label>
            <input 
              type="number" 
              step="0.01"
              value={form.score} 
              onChange={handleChange('score')} 
              placeholder="e.g., 85.5"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" 
            />
            {errors.score && <p className="mt-1 text-xs text-red-600">{String(errors.score)}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Feedback</label>
            <textarea 
              value={form.feedback} 
              onChange={handleChange('feedback')} 
              placeholder="Provide constructive feedback for the student..."
              rows="5"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500" 
            />
            {errors.feedback && <p className="mt-1 text-xs text-red-600">{String(errors.feedback)}</p>}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving && (
              <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
              </svg>
            )}
            {isEditing ? 'Update Grade' : 'Save Grade'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
