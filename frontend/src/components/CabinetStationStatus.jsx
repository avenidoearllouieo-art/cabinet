import { useEffect, useState } from 'react'
import api from '../services/api.js'

const REFRESH_INTERVAL_MS = 15000

function formatOpenedAt(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function CabinetStationStatus({ detailLevel = 'student' }) {
  const [stations, setStations] = useState([])
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let mounted = true
    const refreshStatus = async () => {
      try {
        const response = await api.get('/cabinet-sessions/station-status/')
        if (mounted) {
          setStations(Array.isArray(response.data?.stations) ? response.data.stations : [])
          setLoadError(false)
        }
      } catch {
        if (mounted) setLoadError(true)
      }
    }

    void refreshStatus()
    const intervalId = window.setInterval(() => { void refreshStatus() }, REFRESH_INTERVAL_MS)
    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="cabinet-station-status-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4 sm:px-6">
        <h2 id="cabinet-station-status-title" className="text-base font-semibold text-taptrack-navy">Cabinet Station Status</h2>
        <span className="text-xs text-slate-500" aria-live="polite">
          {loadError ? 'Status refresh unavailable' : 'Live · refreshes every 15 seconds'}
        </span>
      </div>

      {stations.length ? (
        <ul className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          {stations.map((station) => {
            const occupied = station.status === 'OCCUPIED'
            const session = station.active_session
            return (
              <li key={station.station} className="min-w-0 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="truncate font-semibold text-slate-900">{station.station}</h3>
                  <span className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${occupied ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
                    <span className={`h-2.5 w-2.5 rounded-full ${occupied ? 'bg-red-600' : 'bg-emerald-600'}`} aria-hidden="true" />
                    {occupied ? 'OCCUPIED' : 'AVAILABLE'}
                  </span>
                </div>

                {detailLevel !== 'student' && occupied && session && (
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-slate-500">Opened by</dt>
                    <dd className="text-right font-medium text-slate-800">{session.participant_count}</dd>
                    <dt className="text-slate-500">Opened</dt>
                    <dd className="text-right font-medium text-slate-800">{formatOpenedAt(session.opened_at)}</dd>
                    {detailLevel === 'admin' && (
                      <>
                        <dt className="text-slate-500">Session</dt>
                        <dd className="text-right font-medium text-slate-800">#{session.id}</dd>
                      </>
                    )}
                  </dl>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-slate-500 sm:px-6">
          {loadError ? 'Station status is currently unavailable.' : 'Loading station status…'}
        </p>
      )}
    </section>
  )
}