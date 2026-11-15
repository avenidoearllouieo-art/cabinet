import { useState, useEffect } from 'react'
import api from '../../services/api.js'
import { formatAccessLogDuration } from '../accesslogs/accessLogFormatters.js'
import StatusBadge from '../StatusBadge.jsx'
import Modal from '../Modal.jsx'
import { Activity } from 'lucide-react'

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

  return (
      <Modal
        isOpen={isOpen && Boolean(resolvedEventId)}
        onClose={onClose}
        title="Cabinet Event Details"
        description={`${displayEvent.event_type || 'Cabinet event'} · Event #${displayEvent.id || resolvedEventId}`}
        headerIcon={<Activity size={20} />}
        headerActions={<StatusBadge label={displayEvent.result || 'Unknown'} tone={resultTone} />}
        drawer
        maxWidth="min(100vw, 780px)"
        containerClassName="border-l border-[#dbe5f0] shadow-2xl"
        footer={(
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => onDelete?.(displayEvent)} className="min-h-10 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">Delete Event</button>
            <button type="button" onClick={onClose} className="min-h-11 rounded-lg bg-[#FFBE0B] px-4 py-2 text-sm font-bold text-[#082B53] hover:bg-amber-400">Close</button>
          </div>
        )}
      >

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

      </Modal>
  )
}
