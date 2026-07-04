import { createPortal } from 'react-dom'
import { useState } from 'react'
import api from '../../services/api.js'

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

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[520px] rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">Delete Activity</h2>
            <p className="mt-1 text-sm text-[#6B7280]">Are you sure you want to permanently delete this activity?</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl font-bold text-[#475569] transition hover:text-[#0F172A]" aria-label="Close modal">
            ×
          </button>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-slate-700">Activity Title</p>
            <p className="mt-1 text-sm text-slate-900">{activityTitle}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Type</p>
            <p className="mt-1 text-sm text-slate-900">{activity?.activity_type || activity?.type || '—'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Status</p>
            <p className="mt-1 text-sm text-slate-900">{activity?.status || '—'}</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-[#F8FAFC] p-4 text-sm text-[#475569]">This action cannot be undone.</div>

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
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {saving && (
              <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
              </svg>
            )}
            Delete Activity
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
