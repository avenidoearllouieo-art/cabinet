import { useState } from 'react'
import ConfirmationDialog from '../ConfirmationDialog.jsx'
import api from '../../services/api.js'

export default function DeleteSubmissionModal({ isOpen, submission, onClose, onUnauthorized, onDeleted }) {
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const handleDelete = async () => {
    if (!submission?.id) {
      setErrorMessage('Missing submission ID.')
      return
    }

    setSaving(true)
    setErrorMessage('')

    try {
      await api.delete(`/submissions/${submission.id}/`)
      onDeleted && onDeleted(submission.id)
      onClose && onClose()
    } catch (err) {
      if (err.response?.status === 401) {
        onUnauthorized && onUnauthorized()
        return
      }
      if (err.response?.data?.detail) {
        setErrorMessage(err.response.data.detail)
      } else {
        setErrorMessage('Failed to delete submission. Please try again.')
      }
      console.error('Failed to delete submission:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfirmationDialog isOpen={isOpen} title="Delete Submission" description="This action cannot be undone." confirmLabel="Delete" busyLabel="Deleting..." busy={saving} destructive onConfirm={handleDelete} onCancel={onClose}>
      <div className="space-y-4">
        {submission && <div className="rounded-lg border border-slate-200 bg-[#EAF2FB] p-4 text-sm text-slate-800">
          <p><span className="font-semibold text-[#082B53]">Student:</span> {submission.student_name || `${submission.student?.first_name || ''} ${submission.student?.last_name || ''}`.trim() || '—'}</p>
          <p className="mt-2"><span className="font-semibold text-[#082B53]">Activity:</span> {submission.activity_title || submission.activity?.title || '—'}</p>
        </div>}
        {errorMessage && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{errorMessage}</div>}
      </div>
    </ConfirmationDialog>
  )
}
