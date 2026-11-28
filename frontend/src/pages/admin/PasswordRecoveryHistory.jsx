import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import api from '../../services/api.js'
import DataTable from '../../components/DataTable'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal.jsx'
import StatisticsStrip from '../../components/StatisticsStrip.jsx'
import ExpandedDetailsGrid from '../../components/ExpandedDetailsGrid.jsx'

const formatDate = (value) => {
  if (!value) return 'No date recorded'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

const formatLabel = (value) => value ? String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Not recorded'

export default function PasswordRecoveryHistory() {
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState({ count: 0, next: null, previous: null, results: [] })
  const [loadedRequestKey, setLoadedRequestKey] = useState('')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [view, setView] = useState('requests')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [recoveryStats, setRecoveryStats] = useState(null)
  const [recoveryStatsLoading, setRecoveryStatsLoading] = useState(true)
  const [recoveryStatsError, setRecoveryStatsError] = useState(false)
  const [recoveryStatsRange, setRecoveryStatsRange] = useState('30d')
  const [recoveryStatsRetry, setRecoveryStatsRetry] = useState(0)
  const [statusFilter, setStatusFilter] = useState('')
  const requestKey = `${view}:${page}:${reload}`
  const loading = loadedRequestKey !== requestKey
  const totalPages = Math.max(1, Math.ceil(history.count / pageSize))
  const nearbyPages = [...new Set([1, totalPages, page - 1, page, page + 1].filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages))].sort((left, right) => left - right)

  useEffect(() => {
    let active = true
    const params = { page, page_size: pageSize }
    if (view === 'requests') params.view = 'requests'
    if (search.trim()) params.search = search.trim()
    if (statusFilter) params.status = statusFilter
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
  }, [page, reload, view, requestKey, pageSize, search, dateFilter, statusFilter])

  useEffect(() => {
    setRecoveryStatsLoading(true)
    api.get('/admin/password-recovery-history/', { params: { view: 'stats', range: recoveryStatsRange } })
      .then((response) => { setRecoveryStats(response.data); setRecoveryStatsError(false) })
      .catch(() => { setRecoveryStats(null); setRecoveryStatsError(true) })
      .finally(() => setRecoveryStatsLoading(false))
  }, [recoveryStatsRange, recoveryStatsRetry])

  const requestColumns = [
    { key: 'requested_at', label: 'Created', render: formatDate },
    { key: 'student_name', label: 'Student' },
    { key: 'section', label: 'Section' },
    { key: 'account_reference', label: 'Account' },
    { key: 'status', label: 'Status', render: (value) => ({ pending: 'Pending Verification', verified: 'Verified – Awaiting Reset', used: 'Completed', expired: 'Expired', cancelled: 'Cancelled' }[value] || formatLabel(value)) },
    { key: 'nfc_verification_attempt_count', label: 'Verification attempts', render: (value) => Number(value || 0) },
    { key: 'nfc_verified', label: 'NFC', render: (value) => value ? 'Verified' : 'Not verified' },
    { key: 'expires_at', label: 'Expires', render: formatDate },
    { key: 'completed_at', label: 'Completed', render: formatDate },
    { key: 'actions', label: 'Actions', render: (_value, row) => <div className="flex justify-end"><button type="button" onClick={() => setSelectedRequest(row)} className="min-h-9 rounded-md border border-slate-300 px-3 text-xs font-semibold text-taptrack-navy">View</button></div> },
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

      <StatisticsStrip
        loading={recoveryStatsLoading}
        error={recoveryStatsError ? 'Statistics unavailable' : ''}
        onRetry={() => setRecoveryStatsRetry((value) => value + 1)}
        items={[
          { key: 'pending', label: 'Pending Verification', value: recoveryStats?.pending_verification },
          { key: 'awaiting', label: 'Awaiting Password Reset', value: recoveryStats?.awaiting_password_reset ?? recoveryStats?.verified_awaiting_completion },
          { key: 'completed', label: 'Completed Requests', value: recoveryStats?.completed_requests ?? recoveryStats?.completed_in_range },
          { key: 'expired', label: 'Expired Requests', value: recoveryStats?.expired_requests },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">Period
          <select value={recoveryStatsRange} onChange={(event) => setRecoveryStatsRange(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </label>
        <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search recovery records" className="h-11 min-w-[220px] rounded-lg border border-slate-300 px-3 text-sm" />
        <input type="date" aria-label="Recovery date" value={dateFilter} onChange={(event) => { setDateFilter(event.target.value); setPage(1) }} className="h-11 rounded-lg border border-slate-300 px-3 text-sm" />
        {view === 'requests' && (
          <select aria-label="Recovery request status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm">
            <option value="">All statuses</option>
            <option value="pending">Pending Verification</option>
            <option value="verified">Verified – Awaiting Reset</option>
            <option value="used">Completed</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600">Rows
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-10 rounded-md border border-slate-300 px-2">
            {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>

      {view === 'audit' && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Rejected NFC attempts in the last 30 days: <strong className="text-taptrack-navy">{recoveryStats?.rejected_attempts_in_range ?? 'Unavailable'}</strong>
        </div>
      )}

      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1" role="tablist" aria-label="Password recovery views">
        <button type="button" role="tab" aria-selected={view === 'requests'} onClick={() => { setPage(1); setView('requests') }} className={`min-h-10 rounded-md px-4 text-sm font-semibold ${view === 'requests' ? 'bg-taptrack-navy text-white' : 'text-slate-600'}`}>Recovery Requests</button>
        <button type="button" role="tab" aria-selected={view === 'audit'} onClick={() => { setPage(1); setView('audit') }} className={`min-h-10 rounded-md px-4 text-sm font-semibold ${view === 'audit' ? 'bg-taptrack-navy text-white' : 'text-slate-600'}`}>Audit History</button>
      </div>

      <DataTable
        columns={columns}
        data={history.results}
        loading={loading}
        showActions={false}
        expandable
        renderExpandedRow={(row) => (
          <ExpandedDetailsGrid
            items={view === 'requests' ? [
              { label: 'Student', value: row.student_name || 'Unknown account' },
              { label: 'Masked account', value: row.account_reference || '••••' },
              { label: 'Requested at', value: formatDate(row.requested_at) },
              { label: 'Latest verification', value: row.nfc_verified ? 'NFC verified' : 'Not verified' },
              { label: 'Verification attempts', value: Number(row.nfc_verification_attempt_count || 0) },
              { label: 'Expiration', value: row.expires_at ? formatDate(row.expires_at) : 'No expiration recorded' },
              { label: 'Status', value: ({ pending: 'Pending Verification', verified: 'Verified – Awaiting Reset', used: 'Completed', expired: 'Expired', cancelled: 'Cancelled' }[row.status] || formatLabel(row.status)) },
              { label: 'Completion', value: row.completed_at ? formatDate(row.completed_at) : 'Not completed yet' },
            ] : [
              { label: 'Event', value: formatLabel(row.event_type) },
              { label: 'Outcome', value: formatLabel(row.outcome) },
              { label: 'Recorded by', value: formatLabel(row.actor_type) },
              { label: 'Reason', value: row.reason_code ? formatLabel(row.reason_code) : 'No reason recorded' },
              { label: 'Request status', value: formatLabel(row.request_status) },
              { label: 'Student', value: row.student_name || 'Unknown account' },
              { label: 'Masked account', value: row.account_reference || '••••' },
              { label: 'Timestamp', value: formatDate(row.timestamp) },
            ]}
          />
        )}
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
          <button type="button" aria-label="First page" disabled={page === 1 || loading} onClick={() => setPage(1)} className="min-h-10 rounded-md border border-slate-300 px-3 text-xs text-taptrack-navy disabled:opacity-40">First</button>
          <button
            type="button"
            aria-label="Previous page"
            disabled={!history.previous || loading}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-taptrack-navy disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          {nearbyPages.map((pageNumber, index) => (
            <span key={pageNumber} className="flex items-center gap-1">
              {index > 0 && pageNumber - nearbyPages[index - 1] > 1 && <span aria-label="More pages">…</span>}
              <button type="button" onClick={() => setPage(pageNumber)} aria-current={pageNumber === page ? 'page' : undefined} className={`h-10 min-w-10 rounded-md px-2 text-sm ${pageNumber === page ? 'bg-taptrack-gold font-semibold text-taptrack-navy' : 'border border-slate-300 text-taptrack-navy'}`}>{pageNumber}</button>
            </span>
          ))}
          <button
            type="button"
            aria-label="Next page"
            disabled={!history.next || loading}
            onClick={() => setPage((value) => value + 1)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-taptrack-navy disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Last page" disabled={page === totalPages || loading} onClick={() => setPage(totalPages)} className="min-h-10 rounded-md border border-slate-300 px-3 text-xs text-taptrack-navy disabled:opacity-40">Last</button>
        </div>
      </div>
    </div>
  )
}