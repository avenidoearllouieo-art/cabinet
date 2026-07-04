import { useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import ViewAccessLogModal from '../../components/accesslogs/ViewAccessLogModal.jsx'
import DeleteAccessLogModal from '../../components/accesslogs/DeleteAccessLogModal.jsx'
import { Search, LogIn, CheckCircle2, AlertCircle, Eye, Trash2 } from 'lucide-react'

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

export default function AccessLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [viewingLogId, setViewingLogId] = useState(null)
  const [selectedLog, setSelectedLog] = useState(null)
  const [deletingLog, setDeletingLog] = useState(null)
  const [toastMessage, setToastMessage] = useState('')

  useEffect(() => {
    fetchLogs()
  }, [])

  const fetchLogs = async () => {
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
  }

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

  const filteredLogs = useMemo(() => {
    let result = logs

    // Apply search filter
    if (query.trim()) {
      const keyword = query.trim().toLowerCase()
      result = result.filter((log) =>
        [log.username, log.student_id, log.email, log.ip_address]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
      )
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter((log) => {
        const status = String(log.status || '').toLowerCase()
        return status === statusFilter.toLowerCase()
      })
    }

    // Apply role filter
    if (roleFilter !== 'all') {
      result = result.filter((log) => {
        const role = String(log.role || '').toLowerCase()
        return role === roleFilter.toLowerCase()
      })
    }

    return result
  }, [logs, query, statusFilter, roleFilter])

  const totalLogs = logs.length
  const successfulLogins = logs.filter((log) => String(log.status || '').toLowerCase() === 'success').length
  const failedLogins = logs.filter((log) => String(log.status || '').toLowerCase() === 'failed').length

  // Today's logins
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todaysLogins = logs.filter((log) => {
    if (!log.login_time) return false
    const loginDate = new Date(log.login_time)
    loginDate.setHours(0, 0, 0, 0)
    return loginDate.getTime() === today.getTime()
  }).length

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

  const columns = [
    {
      key: 'actions',
      label: 'Actions',
      className: 'min-w-[140px]',
      render: (_value, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenViewModal(row.id, row)}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
            title="View log details"
          >
            <Eye size={14} />
            View
          </button>
          <button
            onClick={() => handleOpenDeleteModal(row)}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
            title="Delete log"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      ),
    },
    {
      key: 'username',
      label: 'Username',
      className: 'min-w-[140px]',
    },
    {
      key: 'student_id',
      label: 'Student ID',
      className: 'min-w-[120px]',
    },
    {
      key: 'email',
      label: 'Email',
      className: 'min-w-[180px]',
    },
    {
      key: 'role',
      label: 'Role',
      className: 'min-w-[100px]',
    },
    {
      key: 'login_time',
      label: 'Login Time',
      className: 'min-w-[160px]',
      render: (value) => formatDate(value),
    },
    {
      key: 'logout_time',
      label: 'Logout Time',
      className: 'min-w-[160px]',
      render: (value) => (value === null ? 'Active' : formatDate(value)),
    },
    {
      key: 'ip_address',
      label: 'IP Address',
      className: 'min-w-[140px]',
      render: (value) => <code className="text-xs text-slate-600">{value || '—'}</code>,
    },
    {
      key: 'device',
      label: 'Device',
      className: 'min-w-[120px]',
    },
    {
      key: 'browser',
      label: 'Browser',
      className: 'min-w-[140px]',
    },
    {
      key: 'operating_system',
      label: 'Operating System',
      className: 'min-w-[140px]',
    },
    {
      key: 'status',
      label: 'Status',
      className: 'min-w-[120px]',
      render: (value) => getStatusBadge(value),
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Access Logs Management"
        description="Monitor user login activity and session information."
      />

      <div className="grid gap-6 md:grid-cols-4">
        <StatCard icon={<LogIn size={18} />} label="Total Logs" value={totalLogs} subtitle="All login records" />
        <StatCard icon={<CheckCircle2 size={18} />} label="Successful Logins" value={successfulLogins} subtitle="Completed sessions" />
        <StatCard icon={<AlertCircle size={18} />} label="Failed Attempts" value={failedLogins} subtitle="Login failures" />
        <StatCard icon={<LogIn size={18} />} label="Today's Logins" value={todaysLogins} subtitle="Sessions today" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Access Log Records</h2>
            <p className="text-sm text-[#6B7280]">View and manage user login sessions.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="relative block">
              <span className="sr-only">Search logs</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search username, email, student ID, or IP"
                className="w-full rounded-full border border-[#E5E7EB] bg-[#F9FAFB] py-3 pl-11 pr-4 text-sm text-[#111827] shadow-sm outline-none transition focus:border-[#2563EB] focus:bg-white"
              />
            </label>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Filter by Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Filter by Role</label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="Admin">Admin</option>
                <option value="Instructor">Instructor</option>
                <option value="Student">Student</option>
              </select>
            </div>
          </div>
        </div>

        <DataTable columns={columns} data={filteredLogs} loading={loading} showActions={false} />
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
