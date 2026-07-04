import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import api from '../../services/api.js'

export default function ViewAccessLogModal({ isOpen, logId, log, onClose, onUnauthorized }) {
  const resolvedLogId = log?.id ?? logId
  const [loading, setLoading] = useState(false)
  const [fetchedLog, setFetchedLog] = useState(null)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!isOpen || !resolvedLogId) return
    
    setFormError('')
    setFetchedLog(null)
    
    const fetchLog = async () => {
      setLoading(true)
      try {
        const res = await api.get(`/access-logs/${resolvedLogId}/`)
        setFetchedLog(res.data || {})
      } catch (e) {
        if (e.response?.status === 401) {
          onUnauthorized && onUnauthorized()
        } else {
          console.error('Failed to load log', e)
          setFormError('Failed to load log details.')
        }
      } finally {
        setLoading(false)
      }
    }

    fetchLog()
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
    } catch (err) {
      return String(value)
    }
  }

  const statusColor = (status) => {
    if (!status) return 'text-slate-600'
    const lower = String(status).toLowerCase()
    if (lower === 'success') return 'text-green-600'
    if (lower === 'failed') return 'text-red-600'
    return 'text-slate-600'
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label="View Access Log">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">Access Log Details</h2>
            <p className="mt-1 text-sm text-[#6B7280]">View the complete login session information.</p>
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
          <div className="space-y-6">
            {/* User Information */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[#111827]">User Information</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Username</p>
                  <p className="mt-1 text-sm text-slate-900">{displayLog.username || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Student ID</p>
                  <p className="mt-1 text-sm text-slate-900">{displayLog.student_id || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Email</p>
                  <p className="mt-1 text-sm text-slate-900">{displayLog.email || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Role</p>
                  <p className="mt-1 text-sm text-slate-900">{displayLog.role || '—'}</p>
                </div>
              </div>
            </div>

            {/* Session Information */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[#111827]">Session Information</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Login Time</p>
                  <p className="mt-1 text-sm text-slate-900">{formatDate(displayLog.login_time)}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Logout Time</p>
                  <p className="mt-1 text-sm text-slate-900">{formatDate(displayLog.logout_time) || displayLog.logout_time === null ? 'Active' : '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Status</p>
                  <p className={`mt-1 text-sm font-medium ${statusColor(displayLog.status)}`}>{displayLog.status || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Duration</p>
                  <p className="mt-1 text-sm text-slate-900">{displayLog.duration || '—'}</p>
                </div>
              </div>
            </div>

            {/* Device & Network Information */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[#111827]">Device & Network Information</h3>
              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">IP Address</p>
                  <p className="mt-1 text-sm text-slate-900 font-mono">{displayLog.ip_address || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Device</p>
                  <p className="mt-1 text-sm text-slate-900">{displayLog.device || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Browser</p>
                  <p className="mt-1 text-sm text-slate-900">{displayLog.browser || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Operating System</p>
                  <p className="mt-1 text-sm text-slate-900">{displayLog.operating_system || '—'}</p>
                </div>
              </div>
            </div>
          </div>
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
