import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import DataTable from '../../components/DataTable'
import StatusBadge from '../../components/StatusBadge'
import ViewCabinetEventModal from '../../components/cabinetevents/ViewCabinetEventModal.jsx'
import DeleteCabinetEventModal from '../../components/cabinetevents/DeleteCabinetEventModal.jsx'
import { Search, Box, Plus } from 'lucide-react'

export default function CabinetEvents() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [cabinetFilter, setCabinetFilter] = useState('all')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const [resultFilter, setResultFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')
  const [sortOrder, setSortOrder] = useState('newest')
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [viewingEventId, setViewingEventId] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [deletingEvent, setDeletingEvent] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const params = new URLSearchParams(window.location.search)
  const selectedUserId = params.get('user') || params.get('user_id')

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true)
      let page = 1
      const allEvents = []
      let hasNextPage = true
      while (hasNextPage) {
        const response = await api.get('/cabinet-events/', {
          params: { page, ...(selectedUserId ? { user: selectedUserId } : {}) },
        })
        const pageEvents = Array.isArray(response.data) ? response.data : response.data.results || []
        allEvents.push(...pageEvents)
        hasNextPage = !Array.isArray(response.data) && Boolean(response.data.next)
        page += 1
      }
      setEvents(allEvents)
      setError('')
    } catch (err) {
      console.error('Error fetching events:', err)
      setError('Failed to load cabinet events.')
    } finally {
      setLoading(false)
    }
  }, [selectedUserId])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchEvents, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchEvents])

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

  const filteredEvents = useMemo(() => {
    let result = events

    if (query.trim()) {
      const keyword = query.trim().toLowerCase()
      result = result.filter((event) =>
        [event.user_name, event.user_identifier, event.role, event.station, event.cabinet_id, event.section_name, event.event_type, event.result]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
      )
    }

    if (cabinetFilter !== 'all') {
      result = result.filter((event) => [event.station, event.cabinet_id].some((value) => String(value || '') === cabinetFilter))
    }

    if (sectionFilter !== 'all') result = result.filter((event) => event.section_name === sectionFilter)
    if (roleFilter !== 'all') result = result.filter((event) => String(event.role || '').toLowerCase() === roleFilter.toLowerCase())
    if (eventTypeFilter !== 'all') {
      result = result.filter((event) => event.event_type === eventTypeFilter)
    }

    if (resultFilter !== 'all') result = result.filter((event) => event.result === resultFilter)
    if (dateFilter) result = result.filter((event) => event.timestamp && new Date(event.timestamp).toLocaleDateString('en-CA') === dateFilter)

    return [...result].sort((left, right) => {
      const leftTime = new Date(left.timestamp || 0).getTime()
      const rightTime = new Date(right.timestamp || 0).getTime()
      return sortOrder === 'oldest' ? leftTime - rightTime : rightTime - leftTime
    })
  }, [events, query, cabinetFilter, sectionFilter, roleFilter, eventTypeFilter, resultFilter, dateFilter, sortOrder])

  const totalEvents = events.length
  const cabinetOpened = events.filter((event) => event.event_type === 'Cabinet Opened').length
  const cabinetClosed = events.filter((event) => event.event_type === 'Cabinet Closed').length
  const activeSessions = events.filter((event) => event.event_type === 'Access Granted').length

  const uniqueCabinets = [...new Set(events.flatMap((event) => [event.station, event.cabinet_id]).filter(Boolean))].sort()
  const uniqueSections = [...new Set(events.map((event) => event.section_name).filter(Boolean))].sort()
  const uniqueRoles = [...new Set(events.map((event) => event.role).filter(Boolean))].sort()

  const getResultBadge = (result) => {
    if (!result || result === '—') return <span className="text-[#6B7280]">—</span>
    return <StatusBadge status={result} label={result} />
  }

  const columns = [
    {
      key: 'actions',
      label: 'Action',
      className: 'w-[16%]',
      render: (_value, row) => (
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => handleOpenDetails(row.id, row)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-taptrack-navy transition hover:border-taptrack-gold hover:bg-taptrack-gold/10"
            title="View details for this event"
          >
            <Plus size={14} aria-hidden="true" />
            View Details
          </button>
        </div>
      ),
    },
    {
      key: 'timestamp',
      label: 'Date & Time',
      className: 'w-[15%]',
      render: (value) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—',
    },
    {
      key: 'user_name',
      label: 'User',
      className: 'w-[12%]',
      render: (value) => value || '—',
    },
    {
      key: 'role',
      label: 'Role',
      className: 'w-[7%]',
      render: (value) => value ? value.charAt(0).toUpperCase() + value.slice(1) : '—',
    },
    {
      key: 'station',
      label: 'Station',
      className: 'w-[9%]',
      render: (value) => value || '—',
    },
    {
      key: 'section_name',
      label: 'Section',
      className: 'w-[10%]',
      render: (value) => value || '—',
    },
    {
      key: 'event_type',
      label: 'Event',
      className: 'w-[14%]',
      render: (value) => value || '—',
    },
    {
      key: 'result',
      label: 'Result',
      className: 'w-[8%]',
      render: (value) => getResultBadge(value),
    },
    {
      key: 'duration_seconds',
      label: 'Duration',
      className: 'w-[9%]',
      render: (value) => value == null ? '—' : value < 60 ? `${value} sec` : `${Math.floor(value / 60)} min`,
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Cabinet Events Management"
        description="Monitor and manage all smart cabinet access events."
      />

      <div className="grid gap-6 md:grid-cols-4">
        <SummaryCard icon={Box} title="Total Events" value={totalEvents} trendText="All cabinet events" iconBg="bg-blue-50" iconColor="text-blue-900" />
        <SummaryCard icon={Box} title="Cabinet Opened" value={cabinetOpened} trendText="Opened events" trendColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-900" />
        <SummaryCard icon={Box} title="Cabinet Closed" value={cabinetClosed} trendText="Closed events" iconBg="bg-slate-100" iconColor="text-slate-700" />
        <SummaryCard icon={Box} title="Active Sessions" value={activeSessions} trendText="Unlocked sessions" trendColor="text-amber-700" iconBg="bg-amber-50" iconColor="text-amber-900" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Cabinet Event Records</h2>
            <p className="text-sm text-[#6B7280]">Browse and manage smart cabinet access events.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="relative block">
              <span className="sr-only">Search events</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events" className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 pl-9 text-sm text-slate-900 outline-none focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/40" />
            </label>
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
              <span className="sr-only">Filter role</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/40">
                <option value="all">All roles</option>
                {uniqueRoles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter event type</span>
              <select value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/40">
                <option value="all">All event types</option>
                {['Access Granted', 'Access Denied', 'Cabinet Opened', 'Cabinet Closed', 'Unlock Failed', 'Session Timeout'].map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter result</span>
              <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/40">
                <option value="all">All results</option>
                {['Success', 'Denied', 'Failed', 'Timeout'].map((result) => <option key={result} value={result}>{result}</option>)}
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

        <DataTable columns={columns} data={filteredEvents} loading={loading} showActions={false} variant="monitoring" emptyMessage={events.length ? 'No cabinet events match these filters.' : 'No cabinet events recorded.'} />
      </div>

      {toastMessage && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-green-500 px-6 py-3 text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      <ViewCabinetEventModal
        isOpen={isDetailsOpen}
        eventId={viewingEventId}
        event={selectedEvent}
        onClose={() => {
          setIsDetailsOpen(false)
          setViewingEventId(null)
          setSelectedEvent(null)
        }}
        onDelete={(event) => {
          setDeletingEvent(event)
          setIsDeleteModalOpen(true)
        }}
        onUnauthorized={() => {
          setIsDetailsOpen(false)
          setViewingEventId(null)
          setSelectedEvent(null)
        }}
      />

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
