import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import ViewInstructorAccessLogModal from '../../components/accesslogs/ViewInstructorAccessLogModal.jsx'
import { Search, CheckCircle2, AlertCircle, LogIn, Users, Eye } from 'lucide-react'

const statusStyles = {
  success: 'bg-[#ECFDF5] text-[#16A34A]',
  failed: 'bg-[#FEE2E2] text-[#B91C1C]',
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

const formatDate = (value) => {
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

export default function InstructorAccessLogs() {
  const [logs, setLogs] = useState([])
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    total_accesses_today: 0,
    successful_accesses_today: 0,
    failed_accesses_today: 0,
    active_students_today: 0,
  })
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [cabinetFilter, setCabinetFilter] = useState('all')
  const [selectedDate, setSelectedDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [pageSize] = useState(25)
  const [selectedLog, setSelectedLog] = useState(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)

  const fetchSections = useCallback(async () => {
    const response = await api.get('/sections/')
    const sectionData = Array.isArray(response.data) ? response.data : response.data.results || []
    setSections(sectionData)
  }, [])

  const fetchStats = useCallback(async () => {
    try {
      const response = await api.get('/access-logs/stats/')
      setStats((current) => response.data || current)
    } catch (err) {
      console.error('Failed to load access log stats:', err)
    }
  }, [])

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const params = {
        page,
        page_size: pageSize,
      }
      if (query.trim()) params.search = query.trim()
      if (statusFilter !== 'all') params.status = statusFilter
      if (sectionFilter !== 'all') params['user__section'] = sectionFilter
      if (cabinetFilter !== 'all') params.cabinet_name = cabinetFilter
      if (selectedDate) {
        params.access_time_after = `${selectedDate}T00:00:00Z`
        params.access_time_before = `${selectedDate}T23:59:59Z`
      }

      const response = await api.get('/access-logs/', { params })
      const data = response.data || {}
      const fetchedLogs = Array.isArray(data) ? data : data.results || []
      setLogs(fetchedLogs)
      if (typeof data.count === 'number') {
        setPageCount(Math.ceil(data.count / pageSize) || 1)
      }
      setError('')
    } catch (err) {
      console.error('Error fetching access logs:', err)
      setError('Failed to load cabinet access logs.')
    } finally {
      setLoading(false)
    }
  }, [cabinetFilter, page, pageSize, query, sectionFilter, selectedDate, statusFilter])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      fetchSections()
      fetchStats()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchSections, fetchStats])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchLogs, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchLogs])

  const uniqueCabinets = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.cabinet_name).filter(Boolean))).sort()
  }, [logs])

  const handleViewDetails = (row) => {
    setSelectedLog(row)
    setIsViewModalOpen(true)
  }

  const clearFilters = () => {
    setQuery('')
    setStatusFilter('all')
    setSectionFilter('all')
    setCabinetFilter('all')
    setSelectedDate('')
    setPage(1)
  }

  const columns = [
    {
      key: 'access_time',
      label: 'Date',
      className: 'min-w-[180px]',
      render: (value) => formatDate(value).split(',')[0] || '—',
    },
    {
      key: 'access_time',
      label: 'Time',
      className: 'min-w-[140px]',
      render: (value) => {
        const formatted = formatDate(value)
        return formatted.includes(',') ? formatted.split(',')[1].trim() : formatted
      },
    },
    { key: 'student_id', label: 'Student ID', className: 'min-w-[140px]' },
    {
      key: 'student_name',
      label: 'Student Name',
      className: 'min-w-[220px]',
    },
    {
      key: 'section_name',
      label: 'Section',
      className: 'min-w-[180px]',
      render: (value) => value || '—',
    },
    {
      key: 'rfid_tag',
      label: 'RFID Tag',
      className: 'min-w-[180px]',
      render: (value) => value || '—',
    },
    {
      key: 'cabinet_name',
      label: 'Cabinet',
      className: 'min-w-[180px]',
      render: (value) => value || '—',
    },
    {
      key: 'status',
      label: 'Access Status',
      className: 'min-w-[140px]',
      render: (value) => getStatusBadge(value),
    },
    {
      key: 'actions',
      label: 'Action',
      className: 'min-w-[150px]',
      render: (_value, row) => (
        <button
          type="button"
          onClick={() => handleViewDetails(row)}
          className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          <Eye size={14} />
          View Details
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Instructor Cabinet Access Logs"
        description="Monitor cabinet access activity for students assigned to your sections."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<LogIn size={18} />} label="Total Cabinet Access Today" value={stats.total_accesses_today} subtitle="All cabinet attempts" />
        <StatCard icon={<CheckCircle2 size={18} />} label="Successful Access" value={stats.successful_accesses_today} subtitle="Open attempts" />
        <StatCard icon={<AlertCircle size={18} />} label="Failed Access" value={stats.failed_accesses_today} subtitle="Denied attempts" />
        <StatCard icon={<Users size={18} />} label="Active Students Today" value={stats.active_students_today} subtitle="Unique students" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Access Log Records</h2>
            <p className="text-sm text-[#6B7280]">Filter and search the cabinet access activity from your assigned sections.</p>
          </div>
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            <Search size={16} />
            Reset Filters
          </button>
        </div>

        <div className="mb-6 flex w-full flex-col items-center justify-between gap-4 rounded-xl border border-slate-100 bg-white p-4 shadow-sm md:flex-row">
          <label className="relative block w-full md:max-w-md">
            <span className="sr-only">Search logs</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="Search student ID, name, or RFID"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-11 text-sm text-slate-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
            />
          </label>

          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          <div className="min-w-[150px]">
            <label className="block text-xs font-medium text-slate-700 mb-1">Section</label>
            <select
              value={sectionFilter}
              onChange={(e) => {
                setSectionFilter(e.target.value)
                setPage(1)
              }}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Sections</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.section_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All</option>
              <option value="success">Success</option>
              <option value="failed">Denied</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Cabinet</label>
            <select
              value={cabinetFilter}
              onChange={(e) => {
                setCabinetFilter(e.target.value)
                setPage(1)
              }}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Cabinets</option>
              {uniqueCabinets.map((cabinet) => (
                <option key={cabinet} value={cabinet}>
                  {cabinet}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                setSelectedDate(event.target.value)
                setPage(1)
              }}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          </div>
        </div>

        <div className="mt-6">
          <DataTable columns={columns} data={logs} loading={loading} />
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            Showing page {page} of {pageCount}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              disabled={page >= pageCount}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <ViewInstructorAccessLogModal
        isOpen={isViewModalOpen}
        log={selectedLog}
        onClose={() => {
          setIsViewModalOpen(false)
          setSelectedLog(null)
        }}
      />
    </div>
  )
}
