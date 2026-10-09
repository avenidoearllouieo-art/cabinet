import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import DataTable from '../../components/DataTable'
import StatusBadge from '../../components/StatusBadge'
import ViewAccessLogModal from '../../components/accesslogs/ViewAccessLogModal.jsx'
import DeleteAccessLogModal from '../../components/accesslogs/DeleteAccessLogModal.jsx'
import { Search, LogIn, CheckCircle2, AlertCircle, Eye, Trash2, ShieldCheck, MoreHorizontal, Globe, KeyRound, Lock, LogOut, UserPlus } from 'lucide-react'

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

const normalizeText = (value) => (value || '').toString().toLowerCase()

export default function AccessLogs() {
  const navigate = useNavigate()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [accessTypeFilter, setAccessTypeFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [studentFilter, setStudentFilter] = useState('all')
  const [cabinetFilter, setCabinetFilter] = useState('all')
  const [stationFilter, setStationFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [photoFilter, setPhotoFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [viewingLogId, setViewingLogId] = useState(null)
  const [selectedLog, setSelectedLog] = useState(null)
  const [deletingLog, setDeletingLog] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [openActionId, setOpenActionId] = useState(null)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const actionMenuRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
        setOpenActionId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPage(1)
      setSelectedIds([])
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [query, statusFilter, roleFilter, accessTypeFilter, dateFilter, sectionFilter, studentFilter, cabinetFilter, stationFilter, actionFilter, photoFilter, sortBy])

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const rawLogs = []
      let currentPage = 1
      let hasNextPage = true
      while (hasNextPage) {
        const response = await api.get('/access-logs/', {
          params: { page: currentPage, page_size: 100 },
        })
        if (Array.isArray(response.data)) {
          rawLogs.push(...response.data)
          hasNextPage = false
        } else {
          rawLogs.push(...(response.data.results || []))
          hasNextPage = Boolean(response.data.next)
          currentPage += 1
        }
      }
      setLogs(rawLogs)
      setError('')
    } catch (err) {
      console.error('Error fetching logs:', err)
      setError('Failed to load access logs.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchLogs, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchLogs])

  const handleLogDeleted = async (deletedLogId) => {
    setLogs((existingLogs) => existingLogs.filter((log) => log.id !== deletedLogId))
    setToastMessage('Access log deleted successfully.')
    setIsDeleteModalOpen(false)
    setDeletingLog(null)
    setIsViewModalOpen(false)
    setViewingLogId(null)
    setSelectedLog(null)
    window.setTimeout(() => setToastMessage(''), 4000)

    try {
      await fetchLogs()
    } catch (err) {
      console.error('Failed to refresh logs after delete', err)
    }
  }

  const handleOpenViewModal = (id, row) => {
    if (!id) return
    setViewingLogId(id)
    setSelectedLog(row || null)
    setIsViewModalOpen(true)
  }

  const handleOpenDeleteModal = (row) => {
    setDeletingLog(row)
    setIsDeleteModalOpen(true)
  }

  const handleDeleteSelected = async () => {
    if (!selectedIds.length) return

    try {
      await Promise.all(selectedIds.map((id) => api.delete(`/access-logs/${id}/`)))
      setLogs((existingLogs) => existingLogs.filter((log) => !selectedIds.includes(log.id)))
      setSelectedIds([])
      setToastMessage('Selected access logs deleted successfully.')
      window.setTimeout(() => setToastMessage(''), 4000)
    } catch (err) {
      console.error('Error deleting selected access logs:', err)
      setToastMessage('Failed to delete selected access logs.')
      window.setTimeout(() => setToastMessage(''), 4000)
    }
  }

  const handleExportRecord = (row) => {
    const csvLines = [
      ['Field', 'Value'],
      ['Time', row.access_time || '—'],
      ['User', row.student_name || row.username || row.user_name || '—'],
      ['Role', row.role || row.user_role || '—'],
      ['Access Type', getAccessTypeLabel(row)],
      ['Station', row.station || '—'],
      ['Result', getResultLabel(row)],
      ['Duration', getDurationValue(row)],
    ]

    const csvContent = csvLines.map((line) => line.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `access-log-${row.id || 'record'}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setToastMessage('Access log exported successfully.')
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  const handleViewUserProfile = (row) => {
    const searchValue = row.student_name || row.username || row.user_name || row.email || ''
    navigate(`/admin/users?query=${encodeURIComponent(searchValue)}`)
    setToastMessage('Opened the Users page for this profile.')
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  const roleOptions = useMemo(() => {
    const roles = Array.from(new Set(logs
      .map((log) => String(log.role || log.user_role || '').trim())
      .filter(Boolean)
      .map((value) => value.toLowerCase())))
      .sort()

    return [{ value: 'all', label: 'All roles' }, ...roles.map((role) => ({ value: role, label: role.charAt(0).toUpperCase() + role.slice(1) }))]
  }, [logs])

  const sectionOptions = useMemo(() => {
    const sections = Array.from(new Set(logs
      .map((log) => String(log.section_name || log.section || '').trim())
      .filter(Boolean)
      .map((value) => value.toLowerCase())))
      .sort()

    return [{ value: 'all', label: 'All sections' }, ...sections.map((section) => ({ value: section, label: section.charAt(0).toUpperCase() + section.slice(1) }))]
  }, [logs])

  const accessTypeOptions = useMemo(() => {
    const accessTypes = Array.from(new Set(logs.map((log) => log.access_type || 'Access Event')))
    return [{ value: 'all', label: 'All access types' }, ...accessTypes.map((type) => ({ value: type, label: type }))]
  }, [logs])

  const logOptions = useMemo(() => {
    const optionsFor = (getValue, getLabel) => {
      const unique = new Map()
      logs.forEach((log) => {
        const value = getValue(log)
        if (value !== null && value !== undefined && value !== '') {
          unique.set(String(value), getLabel(log))
        }
      })
      return [...unique.entries()].sort((left, right) => left[1].localeCompare(right[1]))
    }
    return {
      students: optionsFor((log) => log.user, (log) => `${log.student_name || log.username || 'Student'}${log.student_id ? ` (${log.student_id})` : ''}`),
      cabinets: optionsFor((log) => log.cabinet_name, (log) => log.cabinet_name),
      stations: optionsFor((log) => log.station, (log) => log.station),
      actions: optionsFor((log) => log.action, (log) => log.action),
    }
  }, [logs])

  const filteredLogs = useMemo(() => {
    let result = logs

    if (query.trim()) {
      const keyword = query.trim().toLowerCase()
      result = result.filter((log) =>
        [log.username, log.student_id, log.email, log.ip_address, log.student_name, log.section_name, log.cabinet_name, log.reason]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
      )
    }

    if (statusFilter !== 'all') {
      result = result.filter((log) => resolveResult(log) === statusFilter.toLowerCase())
    }

    if (roleFilter !== 'all') {
      result = result.filter((log) => {
        const role = String(log.role || log.user_role || '').toLowerCase()
        return role === roleFilter.toLowerCase()
      })
    }

    if (accessTypeFilter !== 'all') {
      result = result.filter((log) => getAccessTypeLabel(log) === accessTypeFilter)
    }

    if (dateFilter) {
      result = result.filter((log) => {
        if (!log.access_time) return false
        const logDate = new Date(log.access_time)
        const selectedDate = new Date(dateFilter)
        return logDate.toDateString() === selectedDate.toDateString()
      })
    }

    if (sectionFilter !== 'all') {
      result = result.filter((log) => {
        const section = String(log.section_name || log.section || '').toLowerCase()
        return section === sectionFilter.toLowerCase()
      })
    }

    if (studentFilter !== 'all') result = result.filter((log) => String(log.user) === studentFilter)
    if (cabinetFilter !== 'all') result = result.filter((log) => log.cabinet_name === cabinetFilter)
    if (stationFilter !== 'all') result = result.filter((log) => log.station === stationFilter)
    if (actionFilter !== 'all') result = result.filter((log) => log.action === actionFilter)
    if (photoFilter !== 'all') {
      result = result.filter((log) => {
        const captureStatus = log.photo_capture_status || 'unavailable'
        return photoFilter === 'unavailable' ? captureStatus === 'unavailable' || captureStatus === 'failed' : captureStatus === photoFilter
      })
    }

    const sorted = [...result]
    sorted.sort((left, right) => {
      const leftTime = left.access_time ? new Date(left.access_time).getTime() : 0
      const rightTime = right.access_time ? new Date(right.access_time).getTime() : 0

      if (sortBy === 'oldest') return leftTime - rightTime
      if (sortBy === 'name') {
        const leftName = normalizeText(left.student_name || left.username || left.user_name || left.email)
        const rightName = normalizeText(right.student_name || right.username || right.user_name || right.email)
        return leftName.localeCompare(rightName)
      }
      return rightTime - leftTime
    })

    return sorted
  }, [logs, query, statusFilter, roleFilter, accessTypeFilter, dateFilter, sectionFilter, studentFilter, cabinetFilter, stationFilter, actionFilter, photoFilter, sortBy])

  const totalLogs = logs.length
  const successfulLogins = logs.filter((log) => String(log.status || '').toLowerCase() === 'success').length
  const failedLogins = logs.filter((log) => resolveResult(log) === 'failed').length

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cabinetUnlocksToday = logs.filter((log) => {
    if (!log.access_time) return false
    const logDate = new Date(log.access_time)
    logDate.setHours(0, 0, 0, 0)
    const isToday = logDate.getTime() === today.getTime()
    const isCabinetUnlock = getAccessTypeLabel(log) === 'Cabinet Unlock'
    return isToday && isCabinetUnlock
  }).length

  function resolveResult(row) {
    const raw = String(row.status || '').toLowerCase()
    if (raw === 'success') return 'success'
    if (raw === 'in progress' || raw === 'in_progress' || raw === 'pending' || raw === 'processing') return 'in_progress'
    return raw ? 'failed' : 'in_progress'
  }

  const getResultBadge = (row) => {
    const result = resolveResult(row)
    const label = result === 'success' ? 'Success' : result === 'failed' ? 'Failed' : 'In Progress'
    return <StatusBadge status={label} label={label} />
  }

  const getResultLabel = (row) => {
    const result = resolveResult(row)
    return result === 'success' ? 'Success' : result === 'failed' ? 'Failed' : 'In Progress'
  }

  function getAccessTypeLabel(row) {
    return row.access_type || 'Access Event'
  }

  const getAccessTypeBadge = (row) => {
    const label = getAccessTypeLabel(row)
    const icons = {
      'Cabinet Unlock': KeyRound,
      'Cabinet Opened': Lock,
      'Cabinet Closed': LogOut,
      'NFC Registration': UserPlus,
      'Access Denied': ShieldCheck,
    }
    const Icon = icons[label] || Globe
    return <StatusBadge label={label} tone={label === 'Access Denied' ? 'danger' : 'info'} icon={Icon} />
  }

  const getDurationValue = (row) => {
    if (row.duration_seconds == null) return '—'
    const seconds = row.duration_seconds
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    return `${minutes} min`
  }

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const paginatedLogs = filteredLogs.slice((page - 1) * pageSize, page * pageSize)

  const toggleSelection = (id) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Access Logs Management"
        description="Monitor cabinet and NFC access events across all users."
      />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={LogIn} title="Total Access Logs" value={totalLogs} trendText="All login records" iconBg="bg-blue-50" iconColor="text-blue-900" />
        <SummaryCard icon={CheckCircle2} title="Successful Access" value={successfulLogins} trendText="Completed sessions" trendColor="text-emerald-600" iconBg="bg-emerald-50" iconColor="text-emerald-900" />
        <SummaryCard icon={AlertCircle} title="Failed Access" value={failedLogins} trendText="Login failures" trendColor="text-rose-600" iconBg="bg-rose-50" iconColor="text-rose-900" />
        <SummaryCard icon={ShieldCheck} title="Cabinet Unlocks Today" value={cabinetUnlocksToday} trendText="Unlock events today" iconBg="bg-amber-50" iconColor="text-amber-900" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Access Log Directory</h2>
            <p className="text-sm text-[#6B7280]">Review access events, outcomes, and cabinet unlock activity.</p>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-[360px]">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6B7280]">
              <Search size={16} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search access logs..."
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-10 text-sm text-slate-700 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
            />
          </label>

          <div className="flex flex-1 flex-wrap gap-3 lg:justify-end">
            <label className="min-w-[150px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Filter role</span>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50">
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-[165px] flex-1 lg:max-w-[190px]">
              <span className="sr-only">Filter access type</span>
              <select value={accessTypeFilter} onChange={(e) => setAccessTypeFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50">
                {accessTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-[150px] flex-1 lg:max-w-[160px]">
              <span className="sr-only">Filter result</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50">
                <option value="all">All results</option>
                <option value="success">Success</option>
                <option value="failed">Failed / Denied</option>
              </select>
            </label>
            <label className="min-w-[150px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Filter student</span>
              <select value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50">
                <option value="all">All students</option>
                {logOptions.students.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="min-w-[150px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Filter Cabinet</span>
              <select value={cabinetFilter} onChange={(e) => setCabinetFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50">
                <option value="all">All Cabinets</option>
                {logOptions.cabinets.map(([name, label]) => <option key={name} value={name}>{label}</option>)}
              </select>
            </label>
            <label className="min-w-[150px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Filter station</span>
              <select value={stationFilter} onChange={(e) => setStationFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50">
                <option value="all">All stations</option>
                {logOptions.stations.map(([name, label]) => <option key={name} value={name}>{label}</option>)}
              </select>
            </label>
            <label className="min-w-[150px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Filter action</span>
              <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50">
                <option value="all">All actions</option>
                {logOptions.actions.map(([action, label]) => <option key={action} value={action}>{label}</option>)}
              </select>
            </label>
            <label className="min-w-[150px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Filter photo status</span>
              <select value={photoFilter} onChange={(e) => setPhotoFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50">
                <option value="all">All photo statuses</option>
                <option value="pending">Pending</option>
                <option value="success">Captured</option>
                <option value="failed">Failed</option>
                <option value="unavailable">Unavailable / no record</option>
              </select>
            </label>
            <label className="min-w-[150px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Filter date</span>
              <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50" />
            </label>
            <label className="min-w-[150px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Filter section</span>
              <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50">
                {sectionOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-[150px] flex-1 lg:max-w-[170px]">
              <span className="sr-only">Sort by</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-taptrack-navy focus:ring-2 focus:ring-taptrack-gold/50">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-slate-500">
          <div>
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-3 rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
                <span>{selectedIds.length} selected</span>
                <button type="button" onClick={handleDeleteSelected} className="font-semibold text-[#DC2626]">Delete selected</button>
                <button type="button" onClick={() => setSelectedIds([])} className="font-semibold text-[#374151]">Clear</button>
              </div>
            )}
          </div>
          <div>{filteredLogs.length} result{filteredLogs.length === 1 ? '' : 's'}</div>
        </div>

        <DataTable
          columns={[
            { key: 'access_time', label: 'Date & Time', className: 'w-[14%]', render: (value) => formatDate(value) },
            { key: 'user', label: 'User', className: 'w-[15%]', render: (_value, row) => row.student_name || row.username || row.user_name || 'Unregistered card' },
            { key: 'role', label: 'Role', className: 'w-[8%]', render: (_value, row) => row.role || '—' },
            { key: 'station', label: 'Station', className: 'w-[10%]', render: (_value, row) => row.station || '—' },
            { key: 'access_type', label: 'Access Type', className: 'w-[17%]', render: (_value, row) => getAccessTypeBadge(row) },
            { key: 'status', label: 'Result', className: 'w-[10%]', render: (_value, row) => getResultBadge(row) },
            { key: 'photo_capture_status', label: 'Photo', className: 'w-[9%]', render: (value) => value === 'success' ? 'Captured' : value === 'pending' ? 'Pending' : value === 'failed' ? 'Failed' : 'Unavailable' },
            { key: 'duration_seconds', label: 'Duration', className: 'w-[8%]', render: (_value, row) => getDurationValue(row) },
            {
              key: 'actions',
              label: 'Action',
              className: 'w-[18%]',
              render: (_value, row) => (
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" aria-label={`Select access log ${row.id}`} checked={selectedIds.includes(row.id)} onChange={() => toggleSelection(row.id)} className="h-4 w-4 rounded border-[#D1D5DB]" />
                  <div className="relative" ref={openActionId === row.id ? actionMenuRef : null}>
                    <button type="button" onClick={() => setOpenActionId((current) => (current === row.id ? null : row.id))} className="flex h-8 w-8 items-center justify-center rounded-md border border-[#D1D5DB] bg-white text-taptrack-navy transition hover:bg-taptrack-gold/20" aria-label="Open access log actions">
                      <MoreHorizontal size={16} />
                    </button>
                    {openActionId === row.id && (
                      <div className="absolute right-0 z-30 mt-2 w-48 rounded-[10px] border border-[#E5E7EB] bg-white p-2 shadow-lg">
                        <button type="button" onClick={() => { setOpenActionId(null); handleOpenViewModal(row.id, row) }} className="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6]"><Eye size={14} />View Details</button>
                        <button type="button" onClick={() => { setOpenActionId(null); handleViewUserProfile(row) }} className="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6]"><ShieldCheck size={14} />View User Profile</button>
                        <button type="button" onClick={() => { setOpenActionId(null); handleExportRecord(row) }} className="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6]"><Globe size={14} />Export Record</button>
                        <button type="button" onClick={() => { setOpenActionId(null); handleOpenDeleteModal(row) }} className="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#DC2626] transition hover:bg-[#FEF2F2]"><Trash2 size={14} />Delete</button>
                      </div>
                    )}
                  </div>
                </div>
              ),
            },
          ]}
          data={paginatedLogs}
          loading={loading}
          showActions={false}
          expandable
          variant="monitoring"
          emptyMessage={logs.length ? 'No access logs match your filters.' : 'No access logs available.'}
          renderExpandedRow={(row) => (
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="font-semibold">Event ID</dt><dd>{row.id}</dd></div>
              <div><dt className="font-semibold">Access Method</dt><dd>{row.access_method || '—'}</dd></div>
              <div><dt className="font-semibold">Photo Status</dt><dd>{row.photo_capture_status === 'success' ? 'Captured' : row.photo_capture_status === 'pending' ? 'Pending' : row.photo_capture_status === 'failed' ? 'Unavailable' : 'Unavailable'}</dd></div>
              {row.nfc_uid && <div><dt className="font-semibold">NFC UID</dt><dd className="break-all">{row.nfc_uid}</dd></div>}
              {resolveResult(row) === 'failed' && row.reason && <div className="sm:col-span-2 lg:col-span-3"><dt className="font-semibold">Failure Reason</dt><dd>{row.reason}</dd></div>}
            </dl>
          )}
        />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-[#6B7280]">Showing {filteredLogs.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredLogs.length)} of {filteredLogs.length}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="min-h-11 rounded-[8px] border border-[#D1D5DB] px-3 py-2 text-sm text-[#374151] disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
              <button key={pageNumber} type="button" onClick={() => setPage(pageNumber)} className={`h-11 w-11 rounded-[8px] text-sm ${pageNumber === page ? 'bg-taptrack-gold font-semibold text-taptrack-navy' : 'border border-[#D1D5DB] text-[#374151]'}`}>
                {pageNumber}
              </button>
            ))}
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages} className="min-h-11 rounded-[8px] border border-[#D1D5DB] px-3 py-2 text-sm text-[#374151] disabled:cursor-not-allowed disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>

      {toastMessage && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-green-500 px-6 py-3 text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      <ViewAccessLogModal
        isOpen={isViewModalOpen}
        logId={viewingLogId}
        log={selectedLog}
        onClose={() => {
          setIsViewModalOpen(false)
          setViewingLogId(null)
          setSelectedLog(null)
        }}
        onUnauthorized={() => {
          setIsViewModalOpen(false)
          setViewingLogId(null)
          setSelectedLog(null)
        }}
      />

      <DeleteAccessLogModal
        isOpen={isDeleteModalOpen}
        log={deletingLog}
        onClose={() => {
          setIsDeleteModalOpen(false)
          setDeletingLog(null)
        }}
        onUnauthorized={() => {
          setIsDeleteModalOpen(false)
          setDeletingLog(null)
        }}
        onDeleted={handleLogDeleted}
      />
    </div>
  )
}
