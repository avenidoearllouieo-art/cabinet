import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
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
  }, [query, statusFilter, roleFilter, accessTypeFilter, dateFilter, sectionFilter, sortBy])

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.get('/access-logs/')
      const rawLogs = Array.isArray(response.data) ? response.data : response.data.results || []
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
      ['Location', row.cabinet_name || row.location || row.ip_address || '—'],
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
    const accessTypes = Array.from(new Set(logs.map((log) => {
      const hasCabinet = Boolean(log.cabinet_name || log.cabinet || log.rfid_tag)
      return hasCabinet ? 'cabinet' : 'other'
    })))

    return [{ value: 'all', label: 'All access types' }, ...accessTypes.map((type) => ({ value: type, label: type === 'cabinet' ? 'Cabinet Unlock' : 'Other' }))]
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
      result = result.filter((log) => {
        const status = String(log.status || '').toLowerCase()
        return status === statusFilter.toLowerCase()
      })
    }

    if (roleFilter !== 'all') {
      result = result.filter((log) => {
        const role = String(log.role || log.user_role || '').toLowerCase()
        return role === roleFilter.toLowerCase()
      })
    }

    if (accessTypeFilter !== 'all') {
      result = result.filter((log) => {
        const accessType = log.cabinet_name || log.cabinet || log.rfid_tag ? 'cabinet' : 'other'
        return accessType === accessTypeFilter
      })
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
  }, [logs, query, statusFilter, roleFilter, accessTypeFilter, dateFilter, sectionFilter, sortBy])

  const totalLogs = logs.length
  const successfulLogins = logs.filter((log) => String(log.status || '').toLowerCase() === 'success').length
  const failedLogins = logs.filter((log) => String(log.status || '').toLowerCase() === 'failed').length

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cabinetUnlocksToday = logs.filter((log) => {
    if (!log.access_time) return false
    const logDate = new Date(log.access_time)
    logDate.setHours(0, 0, 0, 0)
    const isToday = logDate.getTime() === today.getTime()
    const isCabinetUnlock = Boolean(log.cabinet_name || log.cabinet || log.rfid_tag)
    return isToday && isCabinetUnlock
  }).length

  const statusStyles = {
    success: 'bg-[#ECFDF5] text-[#16A34A]',
    failed: 'bg-[#FEE2E2] text-[#B91C1C]',
    in_progress: 'bg-[#FEF3C7] text-[#92400E]',
  }

  const resolveResult = (row) => {
    const raw = String(row.status || '').toLowerCase()
    if (raw === 'success') return 'success'
    if (raw === 'failed') return 'failed'
    if (raw === 'in progress' || raw === 'in_progress' || raw === 'pending' || raw === 'processing') return 'in_progress'
    return 'in_progress'
  }

  const getResultBadge = (row) => {
    const result = resolveResult(row)
    const style = statusStyles[result] || statusStyles.in_progress
    const label = result === 'success' ? 'Success' : result === 'failed' ? 'Failed' : 'In Progress'
    return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${style}`}>{label}</span>
  }

  const getResultLabel = (row) => {
    const result = resolveResult(row)
    return result === 'success' ? 'Success' : result === 'failed' ? 'Failed' : 'In Progress'
  }

  const getAccessTypeLabel = (row) => {
    const hasCabinet = Boolean(row.cabinet_name || row.cabinet || row.rfid_tag)
    const reason = String(row.reason || '').toLowerCase()
    if (reason.includes('lock') || reason.includes('locked')) return 'Cabinet Lock'
    if (reason.includes('logout') || reason.includes('sign out') || reason.includes('logged out')) return 'Logout'
    if (reason.includes('register') || reason.includes('registration')) return 'Registration'
    if (hasCabinet) return 'Cabinet Unlock'
    return 'Website Login'
  }

  const getAccessTypeBadge = (row) => {
    const label = getAccessTypeLabel(row)
    const iconProps = { size: 14 }
    const sharedClasses = 'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold'

    switch (label) {
      case 'Cabinet Unlock':
        return <span className={`${sharedClasses} bg-[#DBEAFE] text-[#1D4ED8]`}><KeyRound {...iconProps} />Cabinet Unlock</span>
      case 'Cabinet Lock':
        return <span className={`${sharedClasses} bg-[#E0E7FF] text-[#4338CA]`}><Lock {...iconProps} />Cabinet Lock</span>
      case 'Logout':
        return <span className={`${sharedClasses} bg-[#F3F4F6] text-[#374151]`}><LogOut {...iconProps} />Logout</span>
      case 'Registration':
        return <span className={`${sharedClasses} bg-[#ECFDF5] text-[#16A34A]`}><UserPlus {...iconProps} />Registration</span>
      default:
        return <span className={`${sharedClasses} bg-[#F5F3FF] text-[#7C3AED]`}><Globe {...iconProps} />Website Login</span>
    }
  }

  const getDurationValue = (row) => {
    if (!row.access_time) return '—'
    const start = new Date(row.access_time)
    const end = row.updated_at ? new Date(row.updated_at) : new Date()
    const diffMs = Math.max(0, end.getTime() - start.getTime())
    const seconds = Math.floor(diffMs / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    return `${minutes} min`
  }

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const paginatedLogs = filteredLogs.slice((page - 1) * pageSize, page * pageSize)
  const allVisibleSelected = paginatedLogs.length > 0 && paginatedLogs.every((log) => selectedIds.includes(log.id))

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((current) => current.filter((id) => !paginatedLogs.some((log) => log.id === id)))
      return
    }

    const newIds = Array.from(new Set([...selectedIds, ...paginatedLogs.map((log) => log.id)]))
    setSelectedIds(newIds)
  }

  const toggleSelection = (id) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Access Logs Management"
        description="Monitor user login activity and session information."
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
                <option value="failed">Failed</option>
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

        <div className="max-h-[600px] overflow-auto rounded-[12px] border border-[#E5E7EB] shadow-sm">
          <table className="min-w-full divide-y divide-[#E5E7EB] text-sm">
            <thead className="sticky top-0 z-10 bg-[#F9FAFB] shadow-sm">
              <tr>
                <th className="px-4 py-3 text-left">
                  <label className="flex h-11 w-11 items-center justify-center" aria-label="Select all visible access logs"><input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} className="h-5 w-5 rounded border-[#D1D5DB]" /></label>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Access Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Location</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Result</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB] bg-white">
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-[#6B7280]">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-500" />
                      <span>Loading access logs…</span>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && !paginatedLogs.length && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-[#6B7280]">
                    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
                        <span className="text-2xl">📭</span>
                      </div>
                      <p className="text-lg font-semibold text-slate-900">{logs.length ? 'No access logs match your filters.' : 'No access logs available.'}</p>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && paginatedLogs.map((log, index) => {
                const isSelected = selectedIds.includes(log.id)
                return (
                  <tr key={log.id} className={`${index % 2 ? 'bg-[#F9FAFB]' : 'bg-white'} transition hover:bg-slate-100`}>
                    <td className="px-4 py-4">
                      <label className="flex h-11 w-11 items-center justify-center" aria-label={`Select access log ${log.id}`}><input type="checkbox" checked={isSelected} onChange={() => toggleSelection(log.id)} className="h-5 w-5 rounded border-[#D1D5DB]" /></label>
                    </td>
                    <td className="px-4 py-4 text-[#374151]">{formatDate(log.access_time)}</td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <div className="font-medium text-[#111827]">{log.student_name || log.username || log.user_name || '—'}</div>
                        <div className="text-xs text-[#6B7280]">{log.email || log.user_email || '—'}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-[#374151]">{log.role || log.user_role || '—'}</td>
                    <td className="px-4 py-4">{getAccessTypeBadge(log)}</td>
                    <td className="px-4 py-4 text-[#374151]">{log.cabinet_name || log.location || log.ip_address || '—'}</td>
                    <td className="px-4 py-4">{getResultBadge(log)}</td>
                    <td className="px-4 py-4 text-[#374151]">{getDurationValue(log)}</td>
                    <td className="px-4 py-4">
                      <div className="relative" ref={openActionId === log.id ? actionMenuRef : null}>
                        <button type="button" onClick={() => setOpenActionId((current) => (current === log.id ? null : log.id))} className="flex h-11 w-11 items-center justify-center rounded-full border border-[#D1D5DB] bg-white text-taptrack-navy transition hover:bg-taptrack-gold/20" aria-label="Open access log actions">
                          <MoreHorizontal size={16} />
                        </button>
                        {openActionId === log.id && (
                          <div className="absolute right-0 z-30 mt-2 w-48 rounded-[10px] border border-[#E5E7EB] bg-white p-2 shadow-lg">
                            <button type="button" onClick={() => { setOpenActionId(null); handleOpenViewModal(log.id, log) }} className="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6]">
                              <Eye size={14} />View Details
                            </button>
                            <button type="button" onClick={() => { setOpenActionId(null); handleViewUserProfile(log) }} className="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6]">
                              <ShieldCheck size={14} />View User Profile
                            </button>
                            <button type="button" onClick={() => { setOpenActionId(null); handleExportRecord(log) }} className="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6]">
                              <Globe size={14} />Export Record
                            </button>
                            <button type="button" onClick={() => { setOpenActionId(null); handleOpenDeleteModal(log) }} className="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#DC2626] transition hover:bg-[#FEF2F2]">
                              <Trash2 size={14} />Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-[#6B7280]">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredLogs.length)} of {filteredLogs.length}</div>
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
