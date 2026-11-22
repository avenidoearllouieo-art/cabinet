import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import api from '../../services/api.js'
import DataTable from '../../components/DataTable'
import PageHeader from '../../components/PageHeader'

const formatDate = (value) => {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

const formatLabel = (value) => String(value || '—').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

export default function PasswordRecoveryHistory() {
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState({ count: 0, next: null, previous: null, results: [] })
  const [loadedRequestKey, setLoadedRequestKey] = useState('')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const requestKey = `${page}:${reload}`
  const loading = loadedRequestKey !== requestKey

  useEffect(() => {
    let active = true
    api.get('/admin/password-recovery-history/', { params: { page } })
      .then((response) => {
        if (!active) return
        setHistory(response.data)
        setError('')
      })
      .catch(() => {
        if (active) setError('Password-recovery history could not be loaded.')
      })
      .finally(() => {
        if (active) setLoadedRequestKey(requestKey)
      })
    return () => { active = false }
  }, [page, reload, requestKey])

  const columns = [
    { key: 'timestamp', label: 'Date & time', render: formatDate },
    { key: 'student_name', label: 'Student' },
    { key: 'account_reference', label: 'Account' },
    { key: 'event_type', label: 'Event', render: formatLabel },
    { key: 'outcome', label: 'Outcome', render: formatLabel },
    { key: 'request_status', label: 'Request status', render: formatLabel },
    { key: 'actor_type', label: 'Recorded by', render: formatLabel },
    { key: 'reason_code', label: 'Reason', render: formatLabel },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Password Recovery History"
        description="Review account recovery requests, NFC verification, and password reset outcomes."
        action={(
          <button
            type="button"
            aria-label="Refresh recovery history"
            title="Refresh recovery history"
            onClick={() => setReload((value) => value + 1)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-taptrack-navy hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107]"
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        )}
      />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</div>}

      <DataTable
        columns={columns}
        data={history.results}
        loading={loading}
        showActions={false}
        variant="monitoring"
        emptyMessage="No password-recovery events have been recorded."
        tableClassName="w-full min-w-[900px] table-auto border-collapse text-xs sm:text-sm"
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600" aria-live="polite">{history.count} recovery events</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous page"
            disabled={!history.previous || loading}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-taptrack-navy disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span className="min-w-16 text-center text-sm text-slate-600">Page {page}</span>
          <button
            type="button"
            aria-label="Next page"
            disabled={!history.next || loading}
            onClick={() => setPage((value) => value + 1)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-taptrack-navy disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}