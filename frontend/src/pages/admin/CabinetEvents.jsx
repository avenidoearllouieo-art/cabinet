import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import DataTable from '../../components/DataTable'
import StatusBadge from '../../components/StatusBadge'
import ViewCabinetEventModal from '../../components/cabinetevents/ViewCabinetEventModal.jsx'
import DeleteCabinetEventModal from '../../components/cabinetevents/DeleteCabinetEventModal.jsx'
import SearchField from '../../components/SearchField.jsx'
import Modal from '../../components/Modal.jsx'
import ExpandedDetailsGrid from '../../components/ExpandedDetailsGrid.jsx'
import { Box } from 'lucide-react'

export default function CabinetEvents() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [cabinetFilter, setCabinetFilter] = useState('all')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState('newest')
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [viewingEventId, setViewingEventId] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [deletingEvent, setDeletingEvent] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [serverCount, setServerCount] = useState(0)
  const [sessionStats, setSessionStats] = useState({ active_sessions: 0, completed_sessions: 0, average_completed_duration_seconds: 0, sessions_pending_closing_attendance: 0 })
  const nearbyPages = [...new Set([1, Math.max(1, Math.ceil(serverCount / pageSize)), page - 1, page, page + 1].filter((pageNumber) => pageNumber >= 1 && pageNumber <= Math.max(1, Math.ceil(serverCount / pageSize))))].sort((left, right) => left - right)
  const params = new URLSearchParams(window.location.search)
  const selectedUserId = params.get('user') || params.get('user_id')

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true)
      const params = { page, page_size: pageSize, ordering: sortOrder === 'oldest' ? 'opened_at' : '-opened_at' }
      if (query.trim()) params.search = query.trim()
      if (cabinetFilter !== 'all') params.station = cabinetFilter
      if (sectionFilter !== 'all') params.section = sectionFilter
      if (statusFilter !== 'all') params.status = statusFilter
      if (dateFilter) {
        params.start = dateFilter
        params.end = dateFilter
      }
      const response = await api.get('/cabinet-sessions/', { params })
      const payload = response.data
      const pageEvents = Array.isArray(payload) ? payload : payload.results || []
      setEvents(pageEvents)
      setServerCount(Array.isArray(payload) ? pageEvents.length : Number(payload.count || pageEvents.length))
      setError('')
    } catch (err) {
      console.error('Error fetching events:', err)
      setError('Failed to load cabinet events.')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, query, cabinetFilter, sectionFilter, statusFilter, sortOrder, dateFilter])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchEvents, 300)
    return () => window.clearTimeout(timeoutId)
  }, [fetchEvents])

  useEffect(() => {
    api.get('/cabinet-sessions/stats/', { params: { range: dateFilter ? '30d' : 'today' } })
      .then((response) => setSessionStats(response.data))
      .catch(() => setSessionStats({ active_sessions: 0, completed_sessions: 0, average_completed_duration_seconds: 0, sessions_pending_closing_attendance: 0 }))
  }, [dateFilter])

  const handleEventDeleted = async (deletedEventId) => {
    setEvents((existingEvents) => existingEvents.filter((event) => event.id !== deletedEventId))
    setToastMessage('Cabinet event deleted successfully.')
    setIsDeleteModalOpen(false)
    setDeletingEvent(null)
    setIsDetailsOpen(false)
    setViewingEventId(null)
    setSelectedEvent(null)
    window.setTimeout(() => setToastMessage(''), 4000)

    try {
      await fetchEvents()
    } catch (err) {
      console.error('Failed to refresh events after delete', err)
    }
  }

  const handleOpenDetails = (id, row) => {
    if (!id) return
    setViewingEventId(id)
    setSelectedEvent(row || null)
    setIsDetailsOpen(true)
  }

  const filteredEvents = useMemo(() => events, [events])

  const totalEvents = events.length
  const cabinetOpened = events.filter((event) => event.event_type === 'Cabinet Opened').length
  const cabinetClosed = events.filter((event) => event.event_type === 'Cabinet Closed').length
  const activeSessions = events.filter((event) => event.event_type === 'Access Granted').length

  const uniqueCabinets = [...new Set(events.flatMap((event) => [event.station, event.cabinet_id]).filter(Boolean))].sort()
  const uniqueSections = [...new Set(events.map((event) => event.section_name).filter(Boolean))].sort()

  const getResultBadge = (result) => {
    if (!result || result === '—') return <span className="text-[#6B7280]">—</span>
    return <StatusBadge status={result} label={result} />
  }

  const formatTimestamp = (value, fallback = 'Not recorded') => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : fallback
  const formatDuration = (seconds) => seconds == null ? 'Not recorded' : seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min`
  const formatParticipants = (participants) => Array.isArray(participants) && participants.length
    ? participants.map((participant) => participant.fullName).filter(Boolean).join(', ')
    : 'No participants recorded'

  const columns = [
    { key: 'id', label: 'Session ID', className: 'w-[8%]', render: (value) => `#${value}` },
    { key: 'station', label: 'Station', className: 'w-[10%]' },
    { key: 'opened_by', label: 'Opened by', className: 'w-[15%]', render: (_value, row) => row.opened_by?.length ? formatParticipants(row.opened_by) : (row.session_initiator?.fullName || 'Identity not recorded') },
    { key: 'closed_by', label: 'Closed by', className: 'w-[15%]', render: (_value, row) => row.closed_by?.length ? formatParticipants(row.closed_by) : (row.status === 'open' ? 'Not closed yet' : 'Identity not recorded') },
    { key: 'opened_at', label: 'Opening time', className: 'w-[12%]', render: (value) => formatTimestamp(value) },
    { key: 'closed_at', label: 'Closing time', className: 'w-[12%]', render: (value, row) => formatTimestamp(value, row.status === 'open' ? 'Session still active' : 'Not recorded') },
    { key: 'duration_seconds', label: 'Duration', className: 'w-[8%]', render: formatDuration },
    { key: 'participant_count', label: 'Participants', className: 'w-[8%]' },
    { key: 'status', label: 'Status', className: 'w-[8%]', render: (value) => <StatusBadge status={value === 'open' ? 'Active' : 'Completed'} label={value === 'open' ? 'Active' : 'Completed'} /> },
    {
      key: 'actions', label: 'Actions', className: 'w-[12%]',
      render: (_value, row) => (
        <button type="button" onClick={() => handleOpenDetails(row.id, row)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-taptrack-navy hover:border-taptrack-gold">
          View
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Cabinet Sessions Management"
        description="Monitor complete cabinet usage sessions and preserve raw access events separately."
      />

      <section className="grid grid-cols-2 divide-x divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white py-3 shadow-sm sm:grid-cols-4 sm:divide-y-0" aria-label="Cabinet session statistics">
        {[
          ['Active Sessions', sessionStats.active_sessions],
          ['Completed Sessions', sessionStats.completed_sessions],
          ['Average Duration', sessionStats.average_completed_duration_seconds ? `${Math.floor(sessionStats.average_completed_duration_seconds / 60)} min` : '0 min'],
          ['Pending Closing Attendance', sessionStats.sessions_pending_closing_attendance],
        ].map(([label, value]) => (
          <div key={label} className="px-3 py-2 text-center"><strong className="block text-2xl text-taptrack-navy">{value}</strong><span className="mt-1 block text-xs font-semibold text-slate-500">{label}</span></div>
        ))}
      </section>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Cabinet Session Records</h2>
            <p className="text-sm text-[#6B7280]">Monitor and review cabinet usage sessions.</p>
          </div>

          <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
            <SearchField value={query} onChange={setQuery} onClear={() => setQuery('')} placeholder="Search sessions" ariaLabel="Search sessions" />
            <label>
              <span className="sr-only">Filter station or cabinet</span>
              <select value={cabinetFilter} onChange={(event) => setCabinetFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/40">
                <option value="all">All stations/cabinets</option>
                {uniqueCabinets.map((cabinet) => <option key={cabinet} value={cabinet}>{cabinet}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter section</span>
              <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/40">
                <option value="all">All sections</option>
                {uniqueSections.map((section) => <option key={section} value={section}>{section}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter session status</span>
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
                <option value="all">All statuses</option>
                <option value="open">Active</option>
                <option value="closed">Completed</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Filter date</span>
              <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/40" />
            </label>
            <label>
              <span className="sr-only">Sort date order</span>
              <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/40">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={filteredEvents}
          loading={loading}
          showActions={false}
          expandable
          variant="monitoring"
          emptyMessage={events.length ? 'No cabinet sessions match these filters.' : 'No cabinet sessions recorded.'}
          renderExpandedRow={(row) => (
            <ExpandedDetailsGrid
              items={[
                { label: 'Opening initiator', value: row.session_initiator?.fullName || 'Identity not recorded' },
                { label: 'Closing initiator', value: row.closing_initiator?.fullName || (row.status === 'open' ? 'Not closed yet' : 'Identity not recorded') },
                { label: 'Opening attendance', value: row.opening_attendance_count },
                { label: 'Closing attendance', value: row.closing_attendance_count },
                { label: 'Opened at', value: formatTimestamp(row.opened_at) },
                { label: 'Closed at', value: row.closed_at ? formatTimestamp(row.closed_at) : 'Session still active' },
                { label: 'Duration', value: formatDuration(row.duration_seconds) },
                { label: 'Motor outcome', value: row.motor_command_outcome || 'Not recorded' },
              ]}
            />
          )}
        />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-slate-600">{serverCount} matching sessions</span>
          <label className="flex items-center gap-2 text-sm text-slate-600">Rows
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 rounded-md border border-slate-300 px-2">
              {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page === 1} onClick={() => setPage(1)} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm disabled:opacity-40">First</button>
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm disabled:opacity-40">Previous</button>
            {nearbyPages.map((pageNumber, index) => (
              <span key={pageNumber} className="flex items-center gap-1">
                {index > 0 && pageNumber - nearbyPages[index - 1] > 1 && <span aria-label="More pages">…</span>}
                <button type="button" onClick={() => setPage(pageNumber)} aria-current={pageNumber === page ? 'page' : undefined} className={`h-10 min-w-10 rounded-md px-2 text-sm ${pageNumber === page ? 'bg-taptrack-gold font-semibold text-taptrack-navy' : 'border border-slate-300'}`}>{pageNumber}</button>
              </span>
            ))}
            <button type="button" disabled={page * pageSize >= serverCount} onClick={() => setPage((value) => value + 1)} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm disabled:opacity-40">Next</button>
            <button type="button" disabled={page * pageSize >= serverCount} onClick={() => setPage(Math.max(1, Math.ceil(serverCount / pageSize)))} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm disabled:opacity-40">Last</button>
          </div>
        </div>
      </div>

      {toastMessage && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-green-500 px-6 py-3 text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      <Modal
        isOpen={isDetailsOpen}
        onClose={() => { setIsDetailsOpen(false); setSelectedEvent(null); setViewingEventId(null) }}
        title="Cabinet session details"
        description={selectedEvent ? `Session #${selectedEvent.id} · ${selectedEvent.station}` : ''}
        drawer
        maxWidth="620px"
      >
        {selectedEvent && (
          <div className="max-h-[75vh] space-y-5 overflow-y-auto">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500">Opening initiator</dt><dd className="font-semibold text-slate-900">{selectedEvent.session_initiator?.fullName || 'Not recorded'}</dd></div>
              <div><dt className="text-slate-500">Closing initiator</dt><dd className="font-semibold text-slate-900">{selectedEvent.closing_initiator?.fullName || 'Not recorded'}</dd></div>
              <div><dt className="text-slate-500">Opening attendance</dt><dd>{selectedEvent.opening_attendance_count}</dd></div>
              <div><dt className="text-slate-500">Closing attendance</dt><dd>{selectedEvent.closing_attendance_count}</dd></div>
              <div><dt className="text-slate-500">Pending attendance</dt><dd>{selectedEvent.pending_attendance_count}</dd></div>
              <div><dt className="text-slate-500">Motor command</dt><dd>{selectedEvent.motor_command_outcome}</dd></div>
              <div><dt className="text-slate-500">Physical movement</dt><dd>{selectedEvent.physical_movement_status}</dd></div>
              <div><dt className="text-slate-500">Duration</dt><dd>{formatDuration(selectedEvent.duration_seconds)}</dd></div>
            </dl>

            <section>
              <h3 className="mb-2 font-semibold text-taptrack-navy">Participants</h3>
              <div className="space-y-2">
                {(selectedEvent.attendance || []).map((participant, index) => (
                  <article key={`${participant.studentId || participant.fullName}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="font-semibold text-slate-900">{participant.fullName}</p>
                    <p className="text-sm text-slate-500">{participant.section || 'Section unavailable'}</p>
                    <p className="text-xs text-slate-500">Opening: {participant.openingAttendedAt ? formatTimestamp(participant.openingAttendedAt) : 'Not recorded'} · Closing: {participant.closingAttendedAt ? formatTimestamp(participant.closingAttendedAt) : 'Not recorded'}</p>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 font-semibold text-taptrack-navy">Session timeline</h3>
              <div className="space-y-2">
                {(selectedEvent.access_logs || []).map((log) => (
                  <article key={log.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-900">{log.action} · {log.status}</p>
                    <p className="text-slate-500">{formatTimestamp(log.timestamp)}{log.reason ? ` · ${log.reason}` : ''}</p>
                  </article>
                ))}
                {!selectedEvent.access_logs?.length && <p className="text-sm text-slate-500">No related access log events recorded.</p>}
              </div>
            </section>
          </div>
        )}
      </Modal>

      <DeleteCabinetEventModal
        isOpen={isDeleteModalOpen}
        event={deletingEvent}
        onClose={() => {
          setIsDeleteModalOpen(false)
          setDeletingEvent(null)
        }}
        onUnauthorized={() => {
          setIsDeleteModalOpen(false)
          setDeletingEvent(null)
        }}
        onDeleted={handleEventDeleted}
      />
    </div>
  )
}
