import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import api from '../../services/api.js'

export default function ViewCabinetEventModal({ isOpen, eventId, event, onClose, onDelete, onUnauthorized }) {
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

  const formatDate = (value) => value
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value))
    : '—'

  const formatTime = (value) => value
    ? new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(new Date(value))
    : '—'

  const formatDuration = (seconds) => {
    if (seconds == null) return '—'
    if (seconds < 60) return `${seconds} sec`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return remainingSeconds ? `${minutes} min ${remainingSeconds} sec` : `${minutes} min`
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex bg-black/45" role="presentation">
      <button type="button" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default" aria-label="Close event details" />
      <aside className="relative ml-auto flex h-full w-1/2 min-w-[480px] max-w-[780px] flex-col overflow-y-auto bg-white p-6 shadow-2xl max-md:w-full max-md:min-w-0" role="dialog" aria-modal="true" aria-label="Cabinet Event Details">
        <div className="mb-6 flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Event #{displayEvent.id || resolvedEventId}</p>
            <h2 className="mt-1 text-xl font-semibold text-taptrack-navy">Cabinet Event Details</h2>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-lg text-slate-600 hover:bg-slate-50" aria-label="Close drawer">×</button>
        </div>

        {formError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>}
        {loading ? (
          <div className="rounded-lg border border-slate-200 p-8 text-center text-slate-500">Loading event…</div>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="mb-3 text-sm font-semibold text-taptrack-navy">User Information</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Full Name</dt><dd className="mt-1 break-words text-sm text-slate-900">{displayEvent.user_name || '—'}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Student/User ID</dt><dd className="mt-1 break-words text-sm text-slate-900">{displayEvent.user_identifier || displayEvent.user || '—'}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Role</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.role || '—'}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Section</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.section_name || '—'}</dd></div>
              </dl>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-taptrack-navy">Cabinet Information</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Station</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.station || '—'}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Cabinet ID</dt><dd className="mt-1 break-words text-sm text-slate-900">{displayEvent.cabinet_id || '—'}</dd></div>
              </dl>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-taptrack-navy">Event Information</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Event Type</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.event_type || '—'}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Result</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.result || '—'}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Date</dt><dd className="mt-1 text-sm text-slate-900">{formatDate(displayEvent.timestamp)}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Time</dt><dd className="mt-1 text-sm text-slate-900">{formatTime(displayEvent.timestamp)}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Duration</dt><dd className="mt-1 text-sm text-slate-900">{formatDuration(displayEvent.duration_seconds)}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Event ID</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.id || resolvedEventId}</dd></div>
              </dl>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-taptrack-navy">Access Information</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">NFC UID</dt><dd className="mt-1 break-all font-mono text-sm text-slate-900">{displayEvent.nfc_uid || '—'}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Access Method</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.access_method || '—'}</dd></div>
                {displayEvent.failure_reason && <div className="rounded-lg border border-red-200 bg-red-50 p-3 sm:col-span-2"><dt className="text-xs font-medium text-red-700">Failure/Denial Reason</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-red-900">{displayEvent.failure_reason}</dd></div>}
              </dl>
            </section>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
          <button type="button" onClick={() => onDelete?.(displayEvent)} className="min-h-10 rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Delete Event</button>
          <button type="button" onClick={onClose} className="min-h-10 rounded-md bg-taptrack-navy px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Close</button>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
