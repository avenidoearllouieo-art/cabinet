import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import Pagination from '../../components/Pagination'
import StatusBadge from '../../components/StatusBadge'
import AccessLogPhotoPanel from '../../components/accesslogs/AccessLogPhotoPanel.jsx'
import ViewInstructorAccessLogModal from '../../components/accesslogs/ViewInstructorAccessLogModal.jsx'
import { accessLogResult, accessLogValue, formatAccessLogDate, formatAccessLogTime } from '../../components/accesslogs/accessLogFormatters.js'
import SearchField from '../../components/SearchField.jsx'
import { CheckCircle2, AlertCircle, LogIn, Users, Eye } from 'lucide-react'

const getStatusBadge = (log) => {
  const result = accessLogResult(log)
  if (result === 'Not recorded') return <span className="text-slate-500">{result}</span>
  return <StatusBadge status={result.toLowerCase()} label={result} />
}

export default function InstructorAccessLogs() {
  const location = useLocation()
  const scopedSectionId = new URLSearchParams(location.search).get('section') || ''
  const [logs, setLogs] = useState([])
  const [sections, setSections] = useState([])
  const [cabinetOptions, setCabinetOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState('')
  const [stats, setStats] = useState({
    total_accesses_today: 0,
    successful_accesses_today: 0,
    failed_accesses_today: 0,
    active_students_today: 0,
  })
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sectionFilter, setSectionFilter] = useState(scopedSectionId || 'all')
  const [cabinetFilter, setCabinetFilter] = useState('all')
  const [selectedDate, setSelectedDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [pageSize] = useState(25)
  const [selectedLog, setSelectedLog] = useState(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const activeSectionFilter = scopedSectionId || sectionFilter

  const fetchSections = useCallback(async () => {
    const response = await api.get('/sections/')
    const sectionData = Array.isArray(response.data) ? response.data : response.data.results || []
    setSections(sectionData)
  }, [])

  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const params = activeSectionFilter !== 'all' ? { user__section: activeSectionFilter } : undefined
      const response = await api.get('/access-logs/stats/', { params })
      setStats((current) => response.data || current)
      setStatsError('')
    } catch (err) {
      console.error('Failed to load access log stats:', err)
      setStatsError('Access statistics are unavailable.')
    } finally {
      setStatsLoading(false)
    }
  }, [activeSectionFilter])

  const fetchFilterOptions = useCallback(async () => {
    try {
      const params = activeSectionFilter !== 'all' ? { 'user__section': activeSectionFilter } : undefined
      const response = await api.get('/access-logs/filter-options/', { params })
      setCabinetOptions(Array.isArray(response.data?.cabinets) ? response.data.cabinets : [])
    } catch (err) {
      console.error('Failed to load access log filter options:', err)
      setCabinetOptions([])
    }
  }, [activeSectionFilter])

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const params = {
        page,
        page_size: pageSize,
      }
      if (query.trim()) params.search = query.trim()
      if (statusFilter !== 'all') params.status = statusFilter
      if (activeSectionFilter !== 'all') params['user__section'] = activeSectionFilter
      if (cabinetFilter !== 'all') params.cabinet_name = cabinetFilter
      if (selectedDate) {
        params.access_time_after = selectedDate
        params.access_time_before = selectedDate
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
  }, [activeSectionFilter, cabinetFilter, page, pageSize, query, selectedDate, statusFilter])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      fetchSections()
      fetchStats()
      fetchFilterOptions()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchFilterOptions, fetchSections, fetchStats])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchLogs, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchLogs])

  const handleViewDetails = (row) => {
    setSelectedLog(row)
    setIsViewModalOpen(true)
  }

  const clearFilters = () => {
    setQuery('')
    setStatusFilter('all')
    setSectionFilter(scopedSectionId || 'all')
    setCabinetFilter('all')
    setSelectedDate('')
    setPage(1)
  }

  const columns = [
    {
      key: 'access_time',
      label: 'Date & Time',
      className: 'min-w-[170px]',
      render: (value) => (
        <div>
          <p className="font-medium text-[#102a4c]">{formatAccessLogDate(value)}</p>
          <p className="text-xs text-slate-500">{formatAccessLogTime(value)}</p>
        </div>
      ),
    },
    {
      key: 'student_name',
      label: 'Student',
      className: 'min-w-[140px]',
      render: (value, row) => <div><p className="font-semibold text-[#102a4c]">{accessLogValue(value)}</p><p className="text-xs text-slate-500">{row.student_id || 'ID unavailable'}</p></div>,
    },
    {
      key: 'section_name',
      label: 'Section',
      className: 'min-w-[100px]',
      render: (value) => accessLogValue(value),
    },
    { key: 'cabinet_name', label: 'Cabinet', className: 'min-w-[100px]', render: (value) => accessLogValue(value) },
    {
      key: 'access_result',
      label: 'Access Result',
      className: 'min-w-[95px]',
      render: (_value, row) => getStatusBadge(row),
    },
    {
      key: 'photo_capture_status',
      label: 'Photo',
      className: 'min-w-[70px]',
      render: (value, row) => <AccessLogPhotoPanel eventId={row.id} captureStatus={value} allowImage compact />,
    },
    {
      key: 'reason',
      label: 'Reason',
      className: 'min-w-[130px]',
      render: (_value, row) => accessLogResult(row) === 'Success' ? 'Not applicable' : accessLogValue(row.reason),
    },
    {
      key: 'actions',
      label: 'Action',
      className: 'min-w-[100px]',
      render: (_value, row) => (
        <button
          type="button"
          onClick={() => handleViewDetails(row)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#dbe5f0] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#082b53] transition hover:border-[#ffc107] hover:bg-[#fff9e5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc107]"
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
        title="Access History"
        description="Monitor cabinet access activity for students in your assigned sections."
      />

      <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
        <StatCard icon={<LogIn />} label="Total Access Today" value={statsLoading ? '…' : statsError ? '—' : stats.total_accesses_today} subtitle="Cabinet attempts" bgColor="bg-amber-50" textColor="text-amber-700" />
        <StatCard icon={<CheckCircle2 />} label="Successful Access" value={statsLoading ? '…' : statsError ? '—' : stats.successful_accesses_today} subtitle="Granted attempts" bgColor="bg-emerald-50" textColor="text-emerald-700" />
        <StatCard icon={<AlertCircle />} label="Failed Access" value={statsLoading ? '…' : statsError ? '—' : stats.failed_accesses_today} subtitle="Denied attempts" bgColor="bg-rose-50" textColor="text-rose-700" />
        <StatCard icon={<Users />} label="Active Students" value={statsLoading ? '…' : statsError ? '—' : stats.active_students_today} subtitle="Unique students today" bgColor="bg-blue-50" textColor="text-blue-700" />
      </div>

      {statsError && <p role="status" className="text-sm text-amber-800">{statsError}</p>}

      {error && (
        <div className="rounded-[12px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Your Access History</h2>
            <p className="text-sm text-[#6B7280]">Filter and search the cabinet access activity from your assigned sections.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-500">Showing {logs.length} recent entries</span>
            <button type="button" onClick={clearFilters} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-[#002B5B] transition hover:bg-slate-50">Reset Filters</button>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SearchField value={query} onChange={(value) => { setQuery(value); setPage(1) }} onClear={() => { setQuery(''); setPage(1) }} placeholder="Search student ID, name, or cabinet" ariaLabel="Search logs" />

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Section</label>
            <select
              value={activeSectionFilter}
              onChange={(e) => {
                setSectionFilter(e.target.value)
                setPage(1)
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
            >
              {!scopedSectionId && <option value="all">All Sections</option>}
              {sections.filter((section) => !scopedSectionId || String(section.id) === String(scopedSectionId)).map((section) => (
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
              <option value="failed">Failed</option>
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
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
            >
              <option value="all">All Cabinets</option>
              {cabinetOptions.map((cabinet) => (
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
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
            />
          </div>
        </div>

        <DataTable
          columns={columns}
          data={logs}
          loading={loading}
          showActions={false}
          emptyMessage="No access records found."
          renderMobileCard={(row) => (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="break-words font-semibold text-[#102a4c]">{accessLogValue(row.student_name)}</p><p className="text-xs text-slate-500">{row.student_id || 'ID unavailable'} · {row.section_name || 'Section unavailable'}</p></div>
                {getStatusBadge(row)}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-slate-500">Date &amp; Time</dt><dd className="mt-0.5 font-medium text-slate-700">{formatAccessLogDate(row.access_time)} · {formatAccessLogTime(row.access_time)}</dd></div>
                <div><dt className="text-slate-500">Cabinet</dt><dd className="mt-0.5 font-medium text-slate-700">{accessLogValue(row.cabinet_name)}</dd></div>
                <div><dt className="text-slate-500">Reason</dt><dd className="mt-0.5 break-words font-medium text-slate-700">{accessLogResult(row) === 'Success' ? 'Not applicable' : accessLogValue(row.reason)}</dd></div>
              </dl>
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
                <AccessLogPhotoPanel eventId={row.id} captureStatus={row.photo_capture_status} allowImage compact />
                <button type="button" onClick={() => handleViewDetails(row)} className="instructor-table-action"><Eye size={14} />View details</button>
              </div>
            </div>
          )}
        />

        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} label="Showing page" />
      </div>

      <ViewInstructorAccessLogModal
        isOpen={isViewModalOpen}
        log={selectedLog}
        allowPhotoPreview
        onClose={() => {
          setIsViewModalOpen(false)
          setSelectedLog(null)
        }}
      />
    </div>
  )
}
