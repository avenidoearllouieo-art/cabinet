import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import api from '../../services/api.js'

export default function ViewCabinetEventModal({ isOpen, eventId, event, onClose, onUnauthorized }) {
  const resolvedEventId = event?.id ?? eventId
  const [loading, setLoading] = useState(false)
  const [fetchedEvent, setFetchedEvent] = useState(null)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!isOpen || !resolvedEventId) return
    let active = true
    const timeoutId = window.setTimeout(async () => {
      setFormError('')
      setFetchedEvent(null)
      setLoading(true)
      try {
        const res = await api.get(`/cabinet-events/${resolvedEventId}/`)
        if (active) setFetchedEvent(res.data || {})
      } catch (e) {
        if (e.response?.status === 401) {
          onUnauthorized?.()
        } else {
          console.error('Failed to load event', e)
          if (active) setFormError('Failed to load event details.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [isOpen, resolvedEventId, onUnauthorized])

  if (!isOpen || !resolvedEventId) {
    return null
  }

  const displayEvent = fetchedEvent || event || {}

  const getStatusColor = (status) => {
    if (!status) return 'text-slate-600'
    const lower = String(status).toLowerCase()
    if (lower === 'opened') return 'text-green-600'
    if (lower === 'closed') return 'text-gray-600'
    if (lower === 'unlocked') return 'text-blue-600'
    if (lower === 'locked') return 'text-red-600'
    return 'text-slate-600'
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-[700px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-8 shadow-xl" role="dialog" aria-modal="true" aria-label="View Cabinet Event">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#0F172A]">Cabinet Event Details</h2>
            <p className="mt-1 text-sm text-[#6B7280]">View the complete cabinet access event information.</p>
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
            {/* Student Information */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[#111827]">Student Information</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Student Name</p>
                  <p className="mt-1 text-sm text-slate-900">{displayEvent.student_name || displayEvent.student || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Student ID</p>
                  <p className="mt-1 text-sm text-slate-900">{displayEvent.student_id || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Section</p>
                  <p className="mt-1 text-sm text-slate-900">{displayEvent.section || '—'}</p>
                </div>
              </div>
            </div>

            {/* Cabinet Information */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[#111827]">Cabinet Information</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Cabinet Number</p>
                  <p className="mt-1 text-sm text-slate-900">{displayEvent.cabinet_number || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Event Type</p>
                  <p className="mt-1 text-sm text-slate-900">{displayEvent.event_type || '—'}</p>
                </div>
              </div>
            </div>

            {/* Event Details */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[#111827]">Event Details</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Date</p>
                  <p className="mt-1 text-sm text-slate-900">
                    {displayEvent.date
                      ? new Intl.DateTimeFormat('en-US', {
                          dateStyle: 'medium',
                        }).format(new Date(displayEvent.date))
                      : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Time</p>
                  <p className="mt-1 text-sm text-slate-900">
                    {displayEvent.time
                      ? new Intl.DateTimeFormat('en-US', {
                          timeStyle: 'short',
                        }).format(new Date(`2000-01-01T${displayEvent.time}`))
                      : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Duration</p>
                  <p className="mt-1 text-sm text-slate-900">{displayEvent.duration || '—'}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-medium text-slate-600">Status</p>
                  <p className={`mt-1 text-sm font-medium ${getStatusColor(displayEvent.status)}`}>{displayEvent.status || '—'}</p>
                </div>
              </div>
            </div>

            {/* Remarks */}
            {displayEvent.remarks && (
              <div>
                <h3 className="mb-3 text-sm font-semibold text-[#111827]">Remarks</h3>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-sm text-slate-900 whitespace-pre-wrap">{displayEvent.remarks}</p>
                </div>
              </div>
            )}
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
