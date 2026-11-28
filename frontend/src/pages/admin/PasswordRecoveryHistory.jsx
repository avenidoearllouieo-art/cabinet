import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import api from '../../services/api.js'
import DataTable from '../../components/DataTable'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal.jsx'

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
  const [view, setView] = useState('audit')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [recoveryStats, setRecoveryStats] = useState({ pending_verification: 0, verified_awaiting_completion: 0, completed_in_range: 0, rejected_attempts_in_range: 0 })
  const requestKey = `${view}:${page}:${reload}`
  const loading = loadedRequestKey !== requestKey

  useEffect(() => {
    let active = true
    const params = { page, page_size: pageSize }
    if (view === 'requests') params.view = 'requests'
    if (search.trim()) params.search = search.trim()
    if (dateFilter) {
      params.start = dateFilter
      params.end = dateFilter
    }
    api.get('/admin/password-recovery-history/', { params })
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
  }, [page, reload, view, requestKey, pageSize, search, dateFilter])

  useEffect(() => {
    api.get('/admin/password-recovery-history/', { params: { view: 'stats', range: '30d' } })
      .then((response) => setRecoveryStats(response.data))
      .catch(() => setRecoveryStats({ pending_verification: 0, verified_awaiting_completion: 0, completed_in_range: 0, rejected_attempts_in_range: 0 }))
  }, [])

  const requestColumns = [
    { key: 'requested_at', label: 'Created', render: formatDate },
    { key: 'student_name', label: 'Student' },
    { key: 'section', label: 'Section' },
    { key: 'account_reference', label: 'Account' },
    { key: 'status', label: 'Status', render: formatLabel },
    { key: 'nfc_verified', label: 'NFC', render: (value) => value ? 'Verified' : 'Not verified' },
    { key: 'expires_at', label: 'Expires', render: formatDate },
    { key: 'completed_at', label: 'Completed', render: formatDate },
    { key: 'actions', label: 'Details', render: (_value, row) => <button type="button" onClick={() => setSelectedRequest(row)} className="min-h-9 rounded-md border border-slate-300 px-3 text-xs font-semibold text-taptrack-navy">View Details</button> },
  ]

  const columns = view === 'requests' ? requestColumns : [
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
        title="Password Recovery Management"
        description="Review grouped recovery requests and the complete security audit history."
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Pending verification</p><strong className="text-2xl text-taptrack-navy">{recoveryStats.pending_verification}</strong></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Verified awaiting completion</p><strong className="text-2xl text-taptrack-navy">{recoveryStats.verified_awaiting_completion}</strong></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Completed in 30 days</p><strong className="text-2xl text-taptrack-navy">{recoveryStats.completed_in_range}</strong></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Rejected NFC attempts</p><strong className="text-2xl text-taptrack-navy">{recoveryStats.rejected_attempts_in_range}</strong></div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search recovery records" className="h-11 min-w-[220px] rounded-lg border border-slate-300 px-3 text-sm" />
        <input type="date" aria-label="Recovery date" value={dateFilter} onChange={(event) => { setDateFilter(event.target.value); setPage(1) }} className="h-11 rounded-lg border border-slate-300 px-3 text-sm" />
        <label className="flex items-center gap-2 text-sm text-slate-600">Rows
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-10 rounded-md border border-slate-300 px-2">
            {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>

      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1" role="tablist" aria-label="Password recovery views">
        <button type="button" role="tab" aria-selected={view === 'requests'} onClick={() => { setPage(1); setView('requests') }} className={`min-h-10 rounded-md px-4 text-sm font-semibold ${view === 'requests' ? 'bg-taptrack-navy text-white' : 'text-slate-600'}`}>Recovery Requests</button>
        <button type="button" role="tab" aria-selected={view === 'audit'} onClick={() => { setPage(1); setView('audit') }} className={`min-h-10 rounded-md px-4 text-sm font-semibold ${view === 'audit' ? 'bg-taptrack-navy text-white' : 'text-slate-600'}`}>Audit History</button>
      </div>

      <DataTable
        columns={columns}
        data={history.results}
        loading={loading}
        showActions={false}
        variant="monitoring"
        emptyMessage={view === 'requests' ? 'No password-recovery requests have been recorded.' : 'No password-recovery events have been recorded.'}
        tableClassName="w-full min-w-[900px] table-auto border-collapse text-xs sm:text-sm"
      />

      <Modal
        isOpen={Boolean(selectedRequest)}
        onClose={() => setSelectedRequest(null)}
        title="Recovery request timeline"
        description={selectedRequest ? `Request ${selectedRequest.request_id}` : ''}
        drawer
        maxWidth="620px"
      >
        {selectedRequest && (
          <div className="max-h-[75vh] space-y-3 overflow-y-auto">
            <p className="text-sm text-slate-600">NFC verification attempts: {selectedRequest.nfc_verification_attempt_count}</p>
            {(selectedRequest.timeline || []).map((event, index) => (
              <article key={`${event.event_type}-${index}`} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="font-semibold text-slate-900">{formatLabel(event.event_type)}</p>
                <p className="text-sm text-slate-500">{formatDate(event.timestamp)} · {formatLabel(event.outcome)} · {formatLabel(event.actor_type)}</p>
                {event.reason_code && <p className="text-xs text-slate-500">Reason: {formatLabel(event.reason_code)}</p>}
              </article>
            ))}
          </div>
        )}
      </Modal>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600" aria-live="polite">{history.count} {view === 'requests' ? 'recovery requests' : 'recovery events'}</p>
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