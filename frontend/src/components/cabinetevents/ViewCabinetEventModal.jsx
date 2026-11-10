import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import api from '../../services/api.js'
import { formatAccessLogDuration } from '../accesslogs/accessLogFormatters.js'
import StatusBadge from '../StatusBadge.jsx'
import { X } from 'lucide-react'

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

  const result = String(displayEvent.result || '').toLowerCase()
  const resultTone = result.includes('denied') || result.includes('fail') || result.includes('error')
    ? 'danger'
    : result.includes('success') || result.includes('granted') || result.includes('opened') || result.includes('closed')
      ? 'success'
      : 'neutral'

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex bg-black/45" role="presentation">
      <button type="button" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default" aria-label="Close event details" />
      <aside className="relative ml-auto flex h-full w-1/2 min-w-[480px] max-w-[780px] flex-col overflow-y-auto bg-white p-4 shadow-2xl sm:p-6 max-md:w-full max-md:min-w-0" role="dialog" aria-modal="true" aria-label="Cabinet Event Details">
        <div className="mb-6 flex items-start justify-between gap-4 rounded-lg border-l-4 border-[#ffc107] bg-[#eef4fa] p-4 sm:p-5">
          <div>
            <p className="text-xs font-bold uppercase text-[#526780]">{displayEvent.event_type || 'Cabinet event'}</p>
            <h2 className="mt-1 text-xl font-bold text-taptrack-navy">Cabinet Event Details</h2>
            <p className="mt-1 text-sm text-[#526780]">Event #{displayEvent.id || resolvedEventId}</p>
            <div className="mt-2"><StatusBadge label={displayEvent.result || 'Unknown'} tone={resultTone} /></div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#dbe5f0] bg-white text-[#526780] hover:bg-[#f3f6fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc107]" aria-label="Close drawer"><X size={18} /></button>
        </div>

        {formError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>}
        {loading ? (
          <div className="rounded-lg border border-slate-200 p-8 text-center text-slate-500">Loading event…</div>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="mb-3 text-sm font-semibold text-taptrack-navy">User Information</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-3"><dt className="text-xs font-medium text-slate-500">Full Name</dt><dd className="mt-1 break-words text-sm text-slate-900">{displayEvent.user_name || '—'}</dd></div>
                <div className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-3"><dt className="text-xs font-medium text-slate-500">Student/User ID</dt><dd className="mt-1 break-words text-sm text-slate-900">{displayEvent.user_identifier || displayEvent.user || '—'}</dd></div>
                <div className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-3"><dt className="text-xs font-medium text-slate-500">Role</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.role || '—'}</dd></div>
                <div className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-3"><dt className="text-xs font-medium text-slate-500">Section</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.section_name || '—'}</dd></div>
              </dl>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-taptrack-navy">Cabinet Information</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-3"><dt className="text-xs font-medium text-slate-500">Station</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.station || '—'}</dd></div>
                <div className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-3"><dt className="text-xs font-medium text-slate-500">Cabinet ID</dt><dd className="mt-1 break-words text-sm text-slate-900">{displayEvent.cabinet_id || '—'}</dd></div>
              </dl>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-taptrack-navy">Event Information</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Event Type</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.event_type || '—'}</dd></div>
                <div className="rounded-lg border border-[#dbe5f0] bg-[#f3f6fa] p-3"><dt className="text-xs font-medium text-slate-500">Result</dt><dd className="mt-1"><StatusBadge label={displayEvent.result || '—'} tone={resultTone} /></dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Date</dt><dd className="mt-1 text-sm text-slate-900">{formatDate(displayEvent.timestamp)}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Time</dt><dd className="mt-1 text-sm text-slate-900">{formatTime(displayEvent.timestamp)}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Duration</dt><dd className="mt-1 text-sm text-slate-900">{formatAccessLogDuration(displayEvent.duration_seconds)}</dd></div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Event ID</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.id || resolvedEventId}</dd></div>
              </dl>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-taptrack-navy">Access Information</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-medium text-slate-500">Access Method</dt><dd className="mt-1 text-sm text-slate-900">{displayEvent.access_method || '—'}</dd></div>
                {displayEvent.failure_reason && <div className="rounded-lg border border-red-200 bg-red-50 p-3 sm:col-span-2"><dt className="text-xs font-medium text-red-700">Failure/Denial Reason</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-red-900">{displayEvent.failure_reason}</dd></div>}
              </dl>
            </section>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
          <button type="button" onClick={() => onDelete?.(displayEvent)} className="min-h-10 rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Delete Event</button>
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg bg-[#ffc107] px-4 py-2 text-sm font-bold text-[#082b53] hover:bg-[#e0a800] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#082b53]">Close</button>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
