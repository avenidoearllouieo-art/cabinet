import { useState } from 'react'
import api from '../../services/api.js'
import ConfirmationDialog from '../ConfirmationDialog.jsx'

export default function DeleteAccessLogModal({ isOpen, log, onClose, onUnauthorized, onDeleted }) {
  const resolvedLogId = log?.id
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const username = log?.username || '—'
  const userEmail = log?.email || '—'

  const handleDelete = async () => {
    if (!resolvedLogId) {
      setErrorMessage('Missing log id.')
      return
    }

    setSaving(true)
    setErrorMessage('')

    try {
      await api.delete(`/access-logs/${resolvedLogId}/`)
      onDeleted && onDeleted(resolvedLogId)
      onClose && onClose()
      return
    } catch (err) {
      const status = err.response?.status
      if (status === 401) {
        onUnauthorized && onUnauthorized()
        return
      }
      if (status === 403) {
        setErrorMessage(err.response?.data?.detail || 'Forbidden. You do not have permission to delete this log.')
      } else if (status === 404) {
        setErrorMessage(err.response?.data?.detail || 'Log not found.')
      } else {
        setErrorMessage(err.response?.data?.detail || 'Failed to delete log.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <ConfirmationDialog isOpen={isOpen} title="Delete Access Log" description="Permanently remove this access log." confirmLabel="Delete Log" busyLabel="Deleting..." busy={saving} destructive onConfirm={handleDelete} onCancel={onClose}>
      <div className="space-y-4">
        {errorMessage && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{errorMessage}</div>}
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><dt className="text-sm font-semibold text-[#082B53]">Username</dt><dd className="mt-1 break-all text-sm text-slate-700">{username}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Email</dt><dd className="mt-1 break-all text-sm text-slate-700">{userEmail}</dd></div>
          <div><dt className="text-sm font-semibold text-[#082B53]">Role</dt><dd className="mt-1 text-sm text-slate-700">{log?.role || '—'}</dd></div>
          <div className="sm:col-span-2"><dt className="text-sm font-semibold text-[#082B53]">Login Time</dt><dd className="mt-1 text-sm text-slate-700">{log?.login_time ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(log.login_time)) : '—'}</dd></div>
        </dl>
      </div>
    </ConfirmationDialog>
  )
}
