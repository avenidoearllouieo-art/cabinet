import { useMemo, useEffect, useState } from 'react'
import { ClipboardList, Search, ArrowRight, Plus } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import ActivityDetailModal from '../../components/student/ActivityDetailModal.jsx'

const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'graded', label: 'Graded' },
  { value: 'overdue', label: 'Overdue' },
]

const sortOptions = [
  { value: '-created_at', label: 'Newest' },
  { value: 'created_at', label: 'Oldest' },
  { value: 'due_date', label: 'Due Date' },
  { value: 'title', label: 'Alphabetical' },
]

function statusClass(status) {
  switch ((status || '').toLowerCase()) {
    case 'graded':
      return 'bg-emerald-100 text-emerald-700'
    case 'late submission':
      return 'bg-rose-100 text-rose-700'
    case 'submitted':
      return 'bg-sky-100 text-sky-700'
    default:
      return 'bg-amber-100 text-amber-700'
  }
}

function formatDate(value) {
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

function shortDescription(value) {
  if (!value) return 'No description available.'
  return value.length > 80 ? `${value.slice(0, 80)}…` : value
}

export default function StudentActivities() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalActivities: 0,
    pendingActivities: 0,
    submittedActivities: 0,
    overdueActivities: 0,
  })
  const [activities, setActivities] = useState([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('-created_at')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [activeActivity, setActiveActivity] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(() => {
    fetchStats()
    fetchActivities()
  }, [query, statusFilter, sortBy, page])

  const fetchStats = async () => {
    try {
      const response = await api.get('/activities/stats/')
      setStats(response.data)
    } catch (err) {
      console.error('Failed to load activity stats:', err)
    }
  }

  const fetchActivities = async () => {
    setLoading(true)
    try {
      const params = {
        search: query || undefined,
        ordering: sortBy,
        page,
      }
      if (statusFilter && statusFilter !== 'all') {
        params.status = statusFilter
      }
      const response = await api.get('/activities/', { params })
      setActivities(response.data.results || [])
      setPageCount(Math.ceil((response.data.count || 0) / (response.data.page_size || 10)))
    } catch (err) {
      console.error('Failed to load activities:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleViewActivity = (activity) => {
    setActiveActivity(activity)
    setIsModalOpen(true)
  }

  const handleSubmitActivity = (activity) => {
    window.location.href = `/student/submissions?activity=${activity.id}`
  }

  const tableColumns = useMemo(() => [
    { key: 'title', label: 'Activity Title' },
    { key: 'description', label: 'Description', render: (value) => shortDescription(value) },
    { key: 'instructor_name', label: 'Instructor' },
    { key: 'due_date', label: 'Due Date', render: (value) => formatDate(value) },
    { key: 'student_submission_status', label: 'Status', render: (value) => (
      <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusClass(value)}`}>
        {value}
      </span>
    ) },
    { key: 'student_score', label: 'Score', render: (value) => (value != null ? value : '—') },
    { key: 'actions', label: 'Actions', render: (_, row) => (
      <button
        type="button"
        onClick={() => handleViewActivity(row)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        <ArrowRight size={16} /> View Activity
      </button>
    ) },
  ], [])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Student Activities"
        description="Review the activities assigned to your section and manage your submissions."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<ClipboardList size={18} />} label="Total Activities" value={stats.totalActivities} subtitle="Activities assigned to your section" />
        <StatCard icon={<Search size={18} />} label="Pending Activities" value={stats.pendingActivities} subtitle="Not submitted yet" />
        <StatCard icon={<ArrowRight size={18} />} label="Submitted Activities" value={stats.submittedActivities} subtitle="Activities you have submitted" />
        <StatCard icon={<Plus size={18} />} label="Overdue Activities" value={stats.overdueActivities} subtitle="Past due without submission" />
      </div>

      <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 shadow-sm">
              <Search size={16} className="text-slate-500" />
              <input
                type="text"
                placeholder="Search title or instructor"
                value={query}
                onChange={(event) => {
                  setPage(1)
                  setQuery(event.target.value)
                }}
                className="ml-3 min-w-[240px] bg-transparent text-sm text-slate-900 outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => {
                setPage(1)
                setStatusFilter(event.target.value)
              }}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(event) => {
                setPage(1)
                setSortBy(event.target.value)
              }}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="text-sm text-slate-500">
            Showing {activities.length} of {stats.totalActivities} activities
          </div>
        </div>

        <DataTable
          columns={tableColumns}
          data={activities}
          loading={loading}
          showActions={false}
        />

        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <div>Page {page} of {pageCount || 1}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(current - 1, 1))}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => Math.min(current + 1, pageCount))}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <ActivityDetailModal
        activity={activeActivity}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmitActivity}
      />
    </div>
  )
}
