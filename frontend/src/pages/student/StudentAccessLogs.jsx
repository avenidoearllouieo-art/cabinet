import { useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import ViewInstructorAccessLogModal from '../../components/accesslogs/ViewInstructorAccessLogModal.jsx'
import { Search, CheckCircle2, AlertCircle, LogIn, Eye } from 'lucide-react'

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

export default function StudentAccessLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    total_accesses_today: 0,
    successful_accesses_today: 0,
    failed_accesses_today: 0,
    active_students_today: 0,
  })
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [cabinetFilter, setCabinetFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [selectedLog, setSelectedLog] = useState(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)

  const fetchStats = async () => {
    try {
      const response = await api.get('/access-logs/stats/')
      setStats((current) => response.data || current)
    } catch (err) {
      console.error('Failed to load access log stats:', err)
    }
  }

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const params = { page, page_size: 10 }
      if (query.trim()) params.search = query.trim()
      if (statusFilter !== 'all') params.status = statusFilter
      if (cabinetFilter) params.cabinet_name = cabinetFilter

      const response = await api.get('/access-logs/', { params })
      const data = response.data || {}
      const fetchedLogs = Array.isArray(data) ? data : data.results || []
      setLogs(fetchedLogs)
      if (typeof data.count === 'number') {
        setPageCount(Math.max(1, Math.ceil(data.count / 10)))
      }
    } catch (err) {
      console.error('Failed to load access logs:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [query, statusFilter, cabinetFilter, page])

  const uniqueCabinets = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.cabinet_name).filter(Boolean))).sort()
  }, [logs])

  const handleViewDetails = (row) => {
    setSelectedLog(row)
    setIsViewModalOpen(true)
  }

  const columns = [
    {
      key: 'access_time',
      label: 'Date',
      render: (value) => formatDate(value).split(',')[0] || '—',
    },
    {
      key: 'access_time',
      label: 'Time',
      render: (value) => {
        const formatted = formatDate(value)
        return formatted.includes(',') ? formatted.split(',')[1].trim() : formatted
      },
    },
    {
      key: 'cabinet_name',
      label: 'Cabinet',
      render: (value) => value || '—',
    },
    {
      key: 'rfid_tag',
      label: 'RFID',
      render: (value) => value || '—',
    },
    {
      key: 'status',
      label: 'Status',
      render: (value) => getStatusBadge(value),
    },
    {
      key: 'actions',
      label: 'Action',
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
        title="My Access Logs"
        description="Review your cabinet access history, attempt results, and recent activity."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<LogIn size={18} />} label="Today’s Accesses" value={stats.total_accesses_today} subtitle="All attempts today" />
        <StatCard icon={<CheckCircle2 size={18} />} label="Successful Access" value={stats.successful_accesses_today} subtitle="Approved cabinet access" />
        <StatCard icon={<AlertCircle size={18} />} label="Failed Access" value={stats.failed_accesses_today} subtitle="Denied attempts" />
        <StatCard icon={<Eye size={18} />} label="Recent Records" value={logs.length} subtitle="Shown in the table below" />
      </div>

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Your Access History</h2>
            <p className="text-sm text-[#6B7280]">Search your records and open details for any cabinet activity.</p>
          </div>
          <div className="text-sm text-slate-500">Showing {logs.length} recent entries</div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="relative block">
            <span className="sr-only">Search logs</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setPage(1)
                setQuery(event.target.value)
              }}
              placeholder="Search cabinet or RFID"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-11 text-sm text-slate-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
            />
          </label>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(event) => {
                setPage(1)
                setStatusFilter(event.target.value)
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
              onChange={(event) => {
                setPage(1)
                setCabinetFilter(event.target.value)
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
            >
              <option value="">All Cabinets</option>
              {uniqueCabinets.map((cabinet) => (
                <option key={cabinet} value={cabinet}>
                  {cabinet}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={logs}
          loading={loading}
          showActions={false}
          pagination={{
            current: page,
            total: pageCount,
            onPageChange: setPage,
          }}
        />
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
