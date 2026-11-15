import { useState, useEffect } from 'react'
import api from '../../services/api.js'
import AccessLogPhotoPanel from './AccessLogPhotoPanel.jsx'
import { formatAccessLogDuration } from './accessLogFormatters.js'
import StatusBadge from '../StatusBadge.jsx'
import Modal from '../Modal.jsx'
import { ShieldCheck } from 'lucide-react'

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

  return (
      <Modal
        isOpen={isOpen && Boolean(resolvedLogId)}
        onClose={onClose}
        title="Access Log Details"
        description={`${displayLog.access_type || 'Access event'} · Event #${displayLog.id || resolvedLogId}`}
        headerIcon={<ShieldCheck size={20} />}
        headerActions={<StatusBadge label={displayLog.status || 'Unknown'} tone={statusColor(displayLog.status)} />}
        maxWidth="700px"
      >
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
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#082B53] hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </Modal>
  )
}
