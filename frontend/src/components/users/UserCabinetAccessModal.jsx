import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import api from '../../services/api.js'

function formatDate(value) {
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

function actionLabel(action) {
  const value = String(action || '').toLowerCase()
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : '—'
}

function statusClass(status) {
  return String(status || '').toLowerCase() === 'success'
    ? 'text-emerald-700'
    : String(status || '').toLowerCase() === 'failed'
      ? 'text-red-700'
      : 'text-slate-700'
}

export default function UserCabinetAccessModal({ isOpen, userId, fullName, onClose }) {
  const [logs, setLogs] = useState([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [hasPrevious, setHasPrevious] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen || !userId) return undefined

    let active = true
    const loadPage = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await api.get(`/users/${userId}/access-logs/`, {
          params: { page, page_size: 20 },
        })
        if (!active) return
        setLogs(Array.isArray(response.data?.results) ? response.data.results : [])
        setHasNext(Boolean(response.data?.next))
        setHasPrevious(Boolean(response.data?.previous))
      } catch {
        if (active) {
          setLogs([])
          setError('Unable to load this user’s cabinet access history.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadPage()
    return () => { active = false }
  }, [isOpen, userId, page])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6">
      <section className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="user-access-title">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="user-access-title" className="break-words text-lg font-semibold text-slate-900 sm:text-xl">Cabinet Access — {fullName}</h2>
            <p className="mt-1 text-sm text-slate-500">Access records for this user only.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" aria-label="Close cabinet access history">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-500">Loading access history…</p>
          ) : logs.length ? (
            <>
              <div className="hidden overflow-hidden rounded-lg border border-slate-200 lg:block">
                <table className="w-full table-fixed border-collapse text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="w-[10%] px-3 py-3">Action</th>
                      <th className="w-[10%] px-3 py-3">Status</th>
                      <th className="w-[13%] px-3 py-3">NFC UID</th>
                      <th className="w-[12%] px-3 py-3">Station</th>
                      <th className="w-[15%] px-3 py-3">Cabinet Name</th>
                      <th className="w-[22%] px-3 py-3">Reason</th>
                      <th className="w-[18%] px-3 py-3">Date/Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logs.map((log) => (
                      <tr key={log.id} className="align-top border-b border-slate-100 last:border-0">
                        <td className="break-words px-3 py-3 text-slate-700">{actionLabel(log.action)}</td>
                        <td className={`break-words px-3 py-3 font-medium ${statusClass(log.status)}`}>{String(log.status || '').toLowerCase() === 'success' ? 'Success' : 'Failed'}</td>
                        <td className="break-all px-3 py-3 text-slate-700">{log.nfc_uid || '—'}</td>
                        <td className="break-words px-3 py-3 text-slate-700">{log.station || '—'}</td>
                        <td className="break-words px-3 py-3 text-slate-700">{log.cabinet_name || '—'}</td>
                        <td className="break-words px-3 py-3 text-slate-700">{log.reason || '—'}</td>
                        <td className="break-words px-3 py-3 text-slate-700">{formatDate(log.access_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-3 lg:hidden">
                {logs.map((log) => (
                  <li key={log.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <strong className="text-sm text-slate-900">{actionLabel(log.action)}</strong>
                      <span className={`shrink-0 text-xs font-semibold ${statusClass(log.status)}`}>{String(log.status || '').toLowerCase() === 'success' ? 'Success' : 'Failed'}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                      <dt className="font-medium text-slate-500">NFC UID</dt><dd className="break-all text-slate-700">{log.nfc_uid || '—'}</dd>
                      <dt className="font-medium text-slate-500">Station</dt><dd className="break-words text-slate-700">{log.station || '—'}</dd>
                      <dt className="font-medium text-slate-500">Cabinet Name</dt><dd className="break-words text-slate-700">{log.cabinet_name || '—'}</dd>
                      <dt className="font-medium text-slate-500">Reason</dt><dd className="break-words text-slate-700">{log.reason || '—'}</dd>
                      <dt className="font-medium text-slate-500">Date/Time</dt><dd className="break-words text-slate-700">{formatDate(log.access_time)}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          ) : !error ? (
            <p className="py-10 text-center text-sm text-slate-500">No cabinet access records for this user.</p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-3 sm:px-6">
          <span className="text-xs text-slate-500">Page {page}</span>
          <div className="flex gap-2">
            <button type="button" disabled={!hasPrevious || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
              <ChevronLeft size={16} /> Previous
            </button>
            <button type="button" disabled={!hasNext || loading} onClick={() => setPage((current) => current + 1)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
              Next <ChevronRight size={16} />
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  )
}