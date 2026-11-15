import { useState } from 'react'
import api from '../../services/api.js'
import ConfirmationDialog from '../ConfirmationDialog.jsx'

export default function DeleteActivityModal({ isOpen, activity, onClose, onUnauthorized, onDeleted }) {
  const resolvedActivityId = activity?.id
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const activityTitle = activity?.title || '—'

  const handleDelete = async () => {
    if (!resolvedActivityId) {
      setErrorMessage('Missing activity id.')
      return
    }

    setSaving(true)
    setErrorMessage('')

    try {
      await api.delete(`/activities/${resolvedActivityId}/`)
      onDeleted && onDeleted(resolvedActivityId)
      onClose && onClose()
      return
    } catch (err) {
      const status = err.response?.status
      if (status === 401) {
        onUnauthorized && onUnauthorized()
        return
      }
      if (status === 403) {
        setErrorMessage(err.response?.data?.detail || 'Forbidden. You do not have permission to delete this activity.')
      } else if (status === 404) {
        setErrorMessage(err.response?.data?.detail || 'Activity not found.')
      } else {
        setErrorMessage(err.response?.data?.detail || 'Failed to delete activity.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      title="Delete Activity"
      description="Permanently remove this activity and its related records."
      confirmLabel="Delete Activity"
      busyLabel="Deleting..."
      busy={saving}
      destructive
      onConfirm={handleDelete}
      onCancel={onClose}
    >
      <div className="space-y-4">
        {errorMessage && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{errorMessage}</div>}
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><dt className="text-sm font-semibold text-[#082B53]">Activity Title</dt><dd className="mt-1 break-words text-sm text-slate-700">{activityTitle}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Type</dt><dd className="mt-1 text-sm text-slate-700">{activity?.activity_type || activity?.type || '—'}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Status</dt><dd className="mt-1 text-sm text-slate-700">{activity?.status || '—'}</dd></div>
        </dl>
      </div>
    </ConfirmationDialog>
  )
}
