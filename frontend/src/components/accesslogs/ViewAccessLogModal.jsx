import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import api from '../../services/api.js'
import AccessLogPhotoPanel from './AccessLogPhotoPanel.jsx'
import { formatAccessLogDuration } from './accessLogFormatters.js'
import StatusBadge from '../StatusBadge.jsx'
import { X } from 'lucide-react'

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
        timeZone: 'Asia/Manila',
      }).format(new Date(value))
    } catch {
      return String(value)
    }
  }

  const statusColor = (status) => {
    const lower = String(status).toLowerCase()
    if (lower === 'success') return 'success'
    if (lower.includes('denied') || lower === 'failed' || lower === 'error') return 'danger'
    return 'warning'
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-[700px] overflow-y-auto rounded-xl border border-[#dbe5f0] bg-white p-4 shadow-xl sm:p-6" role="dialog" aria-modal="true" aria-label="View Access Log">
        <div className="mb-5 flex items-start justify-between gap-4 rounded-lg border-l-4 border-[#ffc107] bg-[#eef4fa] p-4 sm:p-5">
          <div>
            <p className="text-xs font-bold uppercase text-[#526780]">{displayLog.access_type || 'Access event'}</p>
            <h2 className="mt-1 text-xl font-bold text-[#102a4c] sm:text-2xl">Access Log Details</h2>
            <p className="mt-1 text-sm text-[#526780]">Event #{displayLog.id || resolvedLogId}</p>
            <div className="mt-2"><StatusBadge label={displayLog.status || 'Unknown'} tone={statusColor(displayLog.status)} /></div>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#dbe5f0] bg-white text-[#526780] transition hover:bg-[#f3f6fa] hover:text-[#102a4c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#082b53]" aria-label="Close modal">
            <X size={18} aria-hidden="true" />
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
            <div className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-3"><dt className="text-xs font-medium text-slate-600">Result</dt><dd className="mt-1"><StatusBadge label={displayLog.status || '—'} tone={statusColor(displayLog.status)} /></dd></div>
            {String(displayLog.status || '').toLowerCase() !== 'success' && displayLog.reason && <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 sm:col-span-2"><dt className="text-xs font-medium text-slate-600">Failure Reason</dt><dd className="mt-1 text-sm text-slate-900">{displayLog.reason}</dd></div>}
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">Date and Time</dt><dd className="mt-1 text-sm text-slate-900">{formatDate(displayLog.access_time)}</dd></div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"><dt className="text-xs font-medium text-slate-600">Duration</dt><dd className="mt-1 text-sm text-slate-900">{formatAccessLogDuration(displayLog.duration_seconds)}</dd></div>
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
            className="min-h-10 rounded-lg border border-[#dbe5f0] bg-white px-4 py-2 text-sm font-semibold text-[#102a4c] hover:bg-[#f3f6fa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#082b53]"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
