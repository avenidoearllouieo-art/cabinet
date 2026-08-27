import { useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import DataTable from '../../components/DataTable'
import ViewCabinetEventModal from '../../components/cabinetevents/ViewCabinetEventModal.jsx'
import EditCabinetEventModal from '../../components/cabinetevents/EditCabinetEventModal.jsx'
import DeleteCabinetEventModal from '../../components/cabinetevents/DeleteCabinetEventModal.jsx'
import { Search, Box, Eye, Edit2, Trash2 } from 'lucide-react'

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch (err) {
    return String(value)
  }
}

export default function CabinetEvents() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [cabinetFilter, setCabinetFilter] = useState('all')
  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [viewingEventId, setViewingEventId] = useState(null)
  const [editingEventId, setEditingEventId] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [deletingEvent, setDeletingEvent] = useState(null)
  const [toastMessage, setToastMessage] = useState('')

  useEffect(() => {
    fetchEvents()
  }, [])

  const fetchEvents = async () => {
    try {
      setLoading(true)
      const response = await api.get('/cabinet-events/')
      const rawEvents = Array.isArray(response.data) ? response.data : response.data.results || []
      setEvents(rawEvents)
      setError('')
    } catch (err) {
      console.error('Error fetching events:', err)
      setError('Failed to load cabinet events.')
    } finally {
      setLoading(false)
    }
  }

  const handleEventSaved = (savedEvent) => {
    if (!savedEvent || !savedEvent.id) {
      fetchEvents()
      return
    }

    setEvents((existingEvents) => {
      return existingEvents.map((event) => (event.id === savedEvent.id ? savedEvent : event))
    })

    setToastMessage('Cabinet event updated successfully.')
    setIsEditModalOpen(false)
    setEditingEventId(null)
    setSelectedEvent(null)
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  const handleEventDeleted = async (deletedEventId) => {
    setEvents((existingEvents) => existingEvents.filter((event) => event.id !== deletedEventId))
    setToastMessage('Cabinet event deleted successfully.')
    setIsDeleteModalOpen(false)
    setDeletingEvent(null)
    setIsViewModalOpen(false)
    setViewingEventId(null)
    setSelectedEvent(null)
    window.setTimeout(() => setToastMessage(''), 4000)

    try {
      await fetchEvents()
    } catch (err) {
      console.error('Failed to refresh events after delete', err)
    }
  }

  const handleOpenViewModal = (id, row) => {
    if (!id) return
    setViewingEventId(id)
    setSelectedEvent(row || null)
    setIsViewModalOpen(true)
  }

  const handleOpenEditModal = (id, row) => {
    if (!id) return
    setEditingEventId(id)
    setSelectedEvent(row || null)
    setIsEditModalOpen(true)
  }

  const handleOpenDeleteModal = (row) => {
    setDeletingEvent(row)
    setIsDeleteModalOpen(true)
  }

  const filteredEvents = useMemo(() => {
    let result = events

    // Apply search filter
    if (query.trim()) {
      const keyword = query.trim().toLowerCase()
      result = result.filter((event) =>
        [event.student_name, event.student, event.student_id, event.cabinet_number, event.section]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
      )
    }

    // Apply cabinet filter
    if (cabinetFilter !== 'all') {
      result = result.filter((event) => {
        const cabinet = String(event.cabinet_number || '')
        return cabinet === cabinetFilter
      })
    }

    // Apply event type filter
    if (eventTypeFilter !== 'all') {
      result = result.filter((event) => {
        const type = String(event.event_type || '').toLowerCase()
        return type === eventTypeFilter.toLowerCase()
      })
    }

    return result
  }, [events, query, cabinetFilter, eventTypeFilter])

  const totalEvents = events.length
  const cabinetOpened = events.filter((event) => String(event.event_type || '').toLowerCase() === 'opened').length
  const cabinetClosed = events.filter((event) => String(event.event_type || '').toLowerCase() === 'closed').length
  const activeSessions = events.filter((event) => String(event.event_type || '').toLowerCase() === 'unlocked').length

  // Get unique cabinet numbers for filter
  const uniqueCabinets = [...new Set(events.map((e) => e.cabinet_number).filter(Boolean))].sort()

  const statusStyles = {
    opened: 'bg-[#ECFDF5] text-[#16A34A]',
    closed: 'bg-[#F3F4F6] text-[#6B7280]',
    unlocked: 'bg-[#DBEAFE] text-[#1E40AF]',
    locked: 'bg-[#FEE2E2] text-[#B91C1C]',
  }

  const getStatusBadge = (status) => {
    if (!status) return <span className="text-[#6B7280]">—</span>
    const lower = String(status).toLowerCase()
    const style = statusStyles[lower] || 'bg-[#F3F4F6] text-[#6B7280]'
    return (
      <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${style}`}>
        {lower.charAt(0).toUpperCase() + lower.slice(1)}
      </span>
    )
  }

  const columns = [
    {
      key: 'actions',
      label: 'Actions',
      className: 'min-w-[160px]',
      render: (_value, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenViewModal(row.id, row)}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-taptrack-gold px-3 py-2 text-xs font-semibold text-taptrack-navy hover:bg-taptrack-gold-hover"
            title="View event"
          >
            <Eye size={14} />
            View
          </button>
          <button
            onClick={() => handleOpenEditModal(row.id, row)}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-taptrack-gold px-3 py-2 text-xs font-semibold text-taptrack-navy hover:bg-taptrack-gold-hover"
            title="Edit event"
          >
            <Edit2 size={14} />
            Edit
          </button>
          <button
            onClick={() => handleOpenDeleteModal(row)}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
            title="Delete event"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      ),
    },
    {
      key: 'student_name',
      label: 'Student Name',
      className: 'min-w-[140px]',
      render: (value, row) => value || row.student || '—',
    },
    {
      key: 'student_id',
      label: 'Student ID',
      className: 'min-w-[120px]',
    },
    {
      key: 'cabinet_number',
      label: 'Cabinet Number',
      className: 'min-w-[120px]',
    },
    {
      key: 'section',
      label: 'Section',
      className: 'min-w-[100px]',
    },
    {
      key: 'event_type',
      label: 'Event Type',
      className: 'min-w-[100px]',
    },
    {
      key: 'date',
      label: 'Date',
      className: 'min-w-[140px]',
      render: (value) =>
        value
          ? new Intl.DateTimeFormat('en-US', {
              dateStyle: 'medium',
            }).format(new Date(value))
          : '—',
    },
    {
      key: 'time',
      label: 'Time',
      className: 'min-w-[80px]',
      render: (value) =>
        value
          ? new Intl.DateTimeFormat('en-US', {
              timeStyle: 'short',
            }).format(new Date(`2000-01-01T${value}`))
          : '—',
    },
    {
      key: 'duration',
      label: 'Duration',
      className: 'min-w-[100px]',
    },
    {
      key: 'status',
      label: 'Status',
      className: 'min-w-[110px]',
      render: (value) => getStatusBadge(value),
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="relative block">
              <span className="sr-only">Search events</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search student, ID, cabinet, section"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-11 text-sm text-slate-900 shadow-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
              />
            </label>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Filter Cabinet</label>
              <select
                value={cabinetFilter}
                onChange={(e) => setCabinetFilter(e.target.value)}
                className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-taptrack-gold/50"
              >
                <option value="all">All Cabinets</option>
                {uniqueCabinets.map((cabinet) => (
                  <option key={cabinet} value={cabinet}>
                    Cabinet {cabinet}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Filter Event Type</label>
              <select
                value={eventTypeFilter}
                onChange={(e) => setEventTypeFilter(e.target.value)}
                className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-taptrack-gold/50"
              >
                <option value="all">All</option>
                <option value="Opened">Opened</option>
                <option value="Closed">Closed</option>
                <option value="Unlocked">Unlocked</option>
                <option value="Locked">Locked</option>
              </select>
            </div>
          </div>
        </div>

        <DataTable columns={columns} data={filteredEvents} loading={loading} showActions={false} variant="monitoring" />
      </div>

      {toastMessage && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-green-500 px-6 py-3 text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      <ViewCabinetEventModal
        isOpen={isViewModalOpen}
        eventId={viewingEventId}
        event={selectedEvent}
        onClose={() => {
          setIsViewModalOpen(false)
          setViewingEventId(null)
          setSelectedEvent(null)
        }}
        onUnauthorized={() => {
          setIsViewModalOpen(false)
          setViewingEventId(null)
          setSelectedEvent(null)
        }}
      />

      <EditCabinetEventModal
        isOpen={isEditModalOpen}
        eventId={editingEventId}
        event={selectedEvent}
        onClose={() => {
          setIsEditModalOpen(false)
          setEditingEventId(null)
          setSelectedEvent(null)
        }}
        onUnauthorized={() => {
          setIsEditModalOpen(false)
          setEditingEventId(null)
          setSelectedEvent(null)
        }}
        onSaved={handleEventSaved}
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
