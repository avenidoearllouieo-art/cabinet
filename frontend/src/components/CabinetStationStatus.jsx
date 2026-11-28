import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api.js'
import Modal from './Modal.jsx'

const REFRESH_INTERVAL_MS = 15000

function formatOpenedAt(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

export default function CabinetStationStatus({ detailLevel = 'student', compact = false }) {
  const [stations, setStations] = useState([])
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [checkedAt, setCheckedAt] = useState(null)
  const [participantSession, setParticipantSession] = useState(null)

  useEffect(() => {
    let mounted = true
    let timeoutId
    const refreshStatus = async () => {
      try {
        const response = await api.get('/cabinet-sessions/station-status/')
        if (mounted) {
          setStations(Array.isArray(response.data?.stations) ? response.data.stations : [])
          setLoadError(false)
          setCheckedAt(new Date())
        }
      } catch {
        if (mounted) {
          setLoadError(true)
        }
      } finally {
        if (mounted) {
          setLoading(false)
          timeoutId = window.setTimeout(refreshStatus, REFRESH_INTERVAL_MS)
        }
      }
    }

    void refreshStatus()
    return () => {
      mounted = false
      window.clearTimeout(timeoutId)
    }
  }, [])

  const checkedAtLabel = checkedAt
    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(checkedAt)
    : null

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="cabinet-station-status-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 sm:px-6 sm:py-4">
        <h2 id="cabinet-station-status-title" className="text-base font-semibold text-taptrack-navy">Cabinet Station Status</h2>
        {compact && <Link to="/admin/access-logs" className="text-sm font-semibold text-taptrack-navy hover:underline">View access logs</Link>}
        <span className="text-xs text-slate-500" aria-live="polite">
          {loadError ? `Offline · ${checkedAtLabel ? `last confirmed ${checkedAtLabel}` : 'status unavailable'}` : checkedAtLabel ? `Checked ${checkedAtLabel} · refreshes every 15 seconds` : 'Checking status…'}
        </span>
      </div>

      {stations.length ? (
        <ul className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          {stations.map((station) => {
            const stationStatus = loadError
              ? 'OFFLINE'
              : station.status === 'OCCUPIED'
                ? 'OCCUPIED'
                : station.status === 'AVAILABLE'
                  ? 'AVAILABLE'
                  : 'UNKNOWN'
            const occupied = stationStatus === 'OCCUPIED'
            const available = stationStatus === 'AVAILABLE'
            const statusClass = occupied
              ? 'bg-red-50 text-red-800'
              : available
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-amber-50 text-amber-900'
            const session = station.active_session
            return (
              <li key={station.station} className="min-w-0 p-3 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="truncate font-semibold text-slate-900">{station.station}</h3>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold sm:gap-2 sm:px-3 sm:text-xs ${statusClass}`}>
                    <span className={`h-2.5 w-2.5 rounded-full ${occupied ? 'bg-red-600' : available ? 'bg-emerald-600' : 'bg-amber-600'}`} aria-hidden="true" />
                    {stationStatus}
                  </span>
                </div>

                {loadError ? (
                  <p className="mt-3 text-sm text-slate-500">Station status could not be refreshed.</p>
                ) : compact ? (
                  occupied ? (
                    <p className="mt-3 text-sm text-slate-500">Occupied · {session?.participant_count || 0} participants</p>
                  ) : available ? (
                    <p className="mt-3 text-sm text-emerald-700">Available for use</p>
                  ) : null
                ) : available ? (
                  <div className="mt-3"><p className="font-medium text-emerald-700">Ready for use</p><p className="text-sm text-slate-500">No active session</p></div>
                ) : detailLevel !== 'student' && occupied && session && (
                  <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-slate-500">{detailLevel === 'instructor' ? 'Initiator' : 'Opened by'}</dt>
                    <dd className="text-right font-medium text-slate-800">
                      {session.initiator?.restricted
                        ? session.initiator.full_name
                        : session.initiator?.full_name || 'Identity not recorded'}
                      {session.initiator?.section ? ` · ${session.initiator.section}` : ''}
                    </dd>
                    {Number(session.participant_count) > 0 && <><dt className="text-slate-500">Participants</dt><dd className="text-right font-medium text-slate-800">{session.participant_count}</dd></>}
                    {Array.isArray(session.participant_previews) && session.participant_previews.length > 0 && <><dt className="text-slate-500">Participants</dt><dd className="text-right font-medium text-slate-800">{session.participant_previews.map((participant) => `${participant.full_name}${participant.section ? ` · ${participant.section}` : ''}`).join(', ')}</dd></>}
                    {session.neutral_message && <><dt className="text-slate-500">Scope</dt><dd className="text-right font-medium text-slate-800">{session.neutral_message}</dd></>}
                    {detailLevel === 'instructor' && Number(session.anonymous_participant_count) > 0 && <><dt className="text-slate-500">Other participants</dt><dd className="text-right font-medium text-slate-800">{session.anonymous_participant_count} anonymous</dd></>}
                    {session.opened_at && <><dt className="text-slate-500">Opened</dt><dd className="text-right font-medium text-slate-800">{formatOpenedAt(session.opened_at)}</dd></>}
                    {session.opened_at && <><dt className="text-slate-500">Live duration</dt><dd className="text-right font-medium text-slate-800">{formatDuration(session.duration_seconds)}</dd></>}
                    {session.updated_at && <><dt className="text-slate-500">Last updated</dt><dd className="text-right font-medium text-slate-800">{formatOpenedAt(session.updated_at)}</dd></>}
                    {detailLevel === 'admin' && session.id && <><dt className="text-slate-500">Session</dt><dd className="text-right font-medium text-slate-800">#{session.id}</dd></>}
                    {Array.isArray(session.participants) && session.participants.length > 0 && (
                      <><dt className="text-slate-500">Details</dt><dd className="text-right"><button type="button" onClick={() => setParticipantSession(session)} className="min-h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold text-taptrack-navy hover:bg-slate-50">View all participants ({session.participant_count})</button></dd></>
                    )}
                  </dl>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="px-3 py-4 text-sm text-slate-500 sm:px-6 sm:py-6">
          {loadError ? 'Station status is currently unavailable.' : loading ? 'Loading station status…' : 'No station status is configured.'}
        </p>
      )}

      <Modal
        isOpen={Boolean(participantSession)}
        onClose={() => setParticipantSession(null)}
        title="Session participants"
        description={participantSession ? `${participantSession.station} · Session #${participantSession.id}` : ''}
        drawer
        maxWidth="520px"
      >
        <div className="max-h-[70vh] space-y-2 overflow-y-auto">
          {(participantSession?.participants || []).map((participant, index) => (
            <article key={`${participant.full_name}-${index}`} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <p className="font-semibold text-slate-900">{participant.full_name}</p>
              <p className="text-sm text-slate-500">{participant.section || 'Section unavailable'}</p>
              {participant.opening_attended_at && <p className="mt-1 text-xs text-slate-500">Opened: {formatOpenedAt(participant.opening_attended_at)}</p>}
              {participant.closing_attended_at && <p className="text-xs text-slate-500">Closed: {formatOpenedAt(participant.closing_attended_at)}</p>}
            </article>
          ))}
        </div>
      </Modal>
    </section>
  )
}