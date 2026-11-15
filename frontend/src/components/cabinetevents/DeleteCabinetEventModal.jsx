import { useState } from 'react'
import api from '../../services/api.js'
import ConfirmationDialog from '../ConfirmationDialog.jsx'

export default function DeleteCabinetEventModal({ isOpen, event, onClose, onUnauthorized, onDeleted }) {
  const resolvedEventId = event?.id
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const userName = event?.user_name || 'Unregistered user'
  const cabinetId = event?.cabinet_id || '—'

  const handleDelete = async () => {
    if (!resolvedEventId) {
      setErrorMessage('Missing event id.')
      return
    }

    setSaving(true)
    setErrorMessage('')

    try {
      await api.delete(`/cabinet-events/${resolvedEventId}/`)
      onDeleted && onDeleted(resolvedEventId)
      onClose && onClose()
      return
    } catch (err) {
      const status = err.response?.status
      if (status === 401) {
        onUnauthorized && onUnauthorized()
        return
      }
      if (status === 403) {
        setErrorMessage(err.response?.data?.detail || 'Forbidden. You do not have permission to delete this event.')
      } else if (status === 404) {
        setErrorMessage(err.response?.data?.detail || 'Event not found.')
      } else {
        setErrorMessage(err.response?.data?.detail || 'Failed to delete event.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <ConfirmationDialog isOpen={isOpen} title="Delete Cabinet Event" description="Permanently remove this cabinet event." confirmLabel="Delete" busyLabel="Deleting..." busy={saving} destructive onConfirm={handleDelete} onCancel={onClose}>
      <div className="space-y-4">
        {errorMessage && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{errorMessage}</div>}
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><dt className="text-sm font-semibold text-[#082B53]">User</dt><dd className="mt-1 text-sm text-slate-700">{userName}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Station</dt><dd className="mt-1 text-sm text-slate-700">{event?.station || '—'}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Cabinet ID</dt><dd className="mt-1 text-sm text-slate-700">{cabinetId}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Event Type</dt><dd className="mt-1 text-sm text-slate-700">{event?.event_type || '—'}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Date &amp; Time</dt><dd className="mt-1 text-sm text-slate-700">{event?.timestamp ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.timestamp)) : '—'}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Result</dt><dd className="mt-1 text-sm text-slate-700">{event?.result || '—'}</dd></div>
        </dl>
      </div>
    </ConfirmationDialog>
  )
}
