import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import api from '../../services/api.js'
import AccessLogPhotoPanel from './AccessLogPhotoPanel.jsx'

export default function ViewAccessLogModal({ isOpen, logId, log, onClose, onUnauthorized }) {
  const resolvedLogId = log?.id ?? logId
  const [loading, setLoading] = useState(false)
  const [fetchedLog, setFetchedLog] = useState(null)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!isOpen || !resolvedLogId) return
    let active = true
    const timeoutId = window.setTimeout(async () => {
      setFormError('')
      setFetchedLog(null)
      setLoading(true)
      try {
        const res = await api.get(`/access-logs/${resolvedLogId}/`)
        if (active) setFetchedLog(res.data || {})
      } catch (e) {
        if (e.response?.status === 401) {
          onUnauthorized?.()
        } else {
          console.error('Failed to load log', e)
          if (active) setFormError('Failed to load log details.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [isOpen, resolvedLogId, onUnauthorized])

  if (!isOpen || !resolvedLogId) {
    return null
  }

  const displayLog = fetchedLog || log || {}

  const formatDate = (value) => {
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

  const formatDuration = (seconds) => {
    if (seconds == null) return '—'
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes} min`
  }

  const statusColor = (status) => {
    if (!status) return 'text-slate-600'
    const lower = String(status).toLowerCase()
    if (lower === 'success') return 'text-green-600'
    if (lower) return 'text-red-600'
    return 'text-slate-600'
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label="View Access Log">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">Access Log Details</h2>
            <p className="mt-1 text-sm text-[#6B7280]">Event #{displayLog.id || resolvedLogId}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xl font-bold text-[#475569] transition hover:text-[#0F172A]" aria-label="Close modal">
            ×
          </button>
        </div>

        {formError && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
        )}

        {loading ? (
          <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280] shadow-sm">Loading...</div>
        ) : (
          <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">Event ID</dt><dd className="mt-1 text-sm text-slate-900">{displayLog.id || resolvedLogId}</dd></div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">User</dt><dd className="mt-1 text-sm text-slate-900">{displayLog.student_name || displayLog.username || displayLog.user_name || (displayLog.user ? `User ${displayLog.user}` : 'Unregistered card')}</dd></div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">Role</dt><dd className="mt-1 text-sm text-slate-900">{displayLog.role || '—'}</dd></div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">Station</dt><dd className="mt-1 text-sm text-slate-900">{displayLog.station || '—'}</dd></div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">Access Type</dt><dd className="mt-1 text-sm text-slate-900">{displayLog.access_type || '—'}</dd></div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">Access Method</dt><dd className="mt-1 text-sm text-slate-900">{displayLog.access_method || '—'}</dd></div>
            {displayLog.nfc_uid && <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">NFC UID</dt><dd className="mt-1 break-all font-mono text-sm text-slate-900">{displayLog.nfc_uid}</dd></div>}
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">Result</dt><dd className={`mt-1 text-sm font-medium ${statusColor(displayLog.status)}`}>{displayLog.status || '—'}</dd></div>
            {String(displayLog.status || '').toLowerCase() !== 'success' && displayLog.reason && <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 sm:col-span-2"><dt className="text-xs font-medium text-slate-600">Failure Reason</dt><dd className="mt-1 text-sm text-slate-900">{displayLog.reason}</dd></div>}
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">Date and Time</dt><dd className="mt-1 text-sm text-slate-900">{formatDate(displayLog.access_time)}</dd></div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">Duration</dt><dd className="mt-1 text-sm text-slate-900">{formatDuration(displayLog.duration_seconds)}</dd></div>
          </dl>
          <div className="mt-4">
            <AccessLogPhotoPanel eventId={resolvedLogId} captureStatus={displayLog.photo_capture_status} allowImage />
          </div>
          </>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
