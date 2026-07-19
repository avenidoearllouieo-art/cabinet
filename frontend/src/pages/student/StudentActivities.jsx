import { useMemo, useEffect, useState } from 'react'
import { ClipboardList, Search, ArrowRight, Plus, Clock, CheckCircle2, AlertCircle, User } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import ActivityDetailInlineModal from '../../components/student/ActivityDetailInlineModal.jsx'

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

function humanRemaining(due) {
  if (!due) return '—'
  const diff = new Date(due).getTime() - Date.now()
  const abs = Math.abs(diff)
  const minutes = Math.round(abs / 60000)
  if (diff < 0) {
    if (minutes < 60) return `${minutes}m overdue`
    if (minutes < 1440) return `${Math.round(minutes / 60)}h overdue`
    return `${Math.round(minutes / 1440)}d overdue`
  }
  if (minutes < 60) return `${minutes}m left`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h left`
  return `${Math.round(minutes / 1440)}d left`
}

function statusBadge(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('graded')) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"><CheckCircle2 size={12} /> Graded</span>
  if (s.includes('submitted')) return <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700"><User size={12} /> Submitted</span>
  if (s.includes('late') || s.includes('overdue')) return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"><AlertCircle size={12} /> Overdue</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"><Clock size={12} /> Pending</span>
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

  useEffect(() => {
    // ensure page resets when filters change
    setPage(1)
  }, [query, statusFilter, sortBy])

  const fetchStats = async () => {
    try {
      const response = await api.get('/activities/stats/')
      setStats(response.data)
    } catch (err) {
      console.error('Failed to load activity stats:', err)
    }
  }

  const computeStatsFromActivities = (acts) => {
    const total = acts.length
    let submitted = 0
    let overdue = 0
    let pending = 0

    acts.forEach((a) => {
      const status = String(a.student_submission_status || '').toLowerCase()
      if (status === 'submitted') submitted += 1
      else if (status === 'overdue') overdue += 1
      else pending += 1
    })

    setStats({
      totalActivities: total,
      pendingActivities: pending,
      submittedActivities: submitted,
      overdueActivities: overdue,
    })
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
      const fetchedActivities = response.data.results || []
      setPageCount(Math.ceil((response.data.count || 0) / (response.data.page_size || 10)))

      // Fetch current user profile to get student id, then fetch that student's submissions
      let profile = null
      try {
        const profileRes = await api.get('/users/profile/')
        profile = profileRes.data
      } catch (err) {
        // ignore profile fetch error
      }

      let submissions = []
      try {
        if (profile?.id) {
          const subsRes = await api.get('/submissions/', { params: { student: profile.id, page_size: 1000 } })
          submissions = Array.isArray(subsRes.data) ? subsRes.data : subsRes.data.results || []
        }
      } catch (err) {
        console.error('Failed to load submissions for student:', err)
      }

      // Map submissions by activity id
      const submissionMap = new Map()
      submissions.forEach((s) => {
        submissionMap.set(String(s.activity), s)
      })

      // Annotate activities with submission-derived status fields
      const annotated = fetchedActivities.map((act) => {
        const sub = submissionMap.get(String(act.id)) || null
        const duePassed = act.due_date ? new Date(act.due_date) < new Date() : false

        if (sub) {
          return {
            ...act,
            student_submission_status: 'Submitted',
            student_submitted_at: sub.submitted_at || sub.created_at || null,
            student_score: sub.score ?? null,
            submission: sub,
          }
        }

        return {
          ...act,
          student_submission_status: duePassed ? 'Overdue' : 'Not Submitted',
          student_submitted_at: null,
          student_score: null,
          submission: null,
        }
      })

      setActivities(annotated)
      computeStatsFromActivities(annotated)
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
    setActiveActivity(activity)
    setIsModalOpen(true)
  }

  const handleModalSuccess = () => {
    setIsModalOpen(false)
    setActiveActivity(null)
    fetchActivities()
  }

  const tableColumns = useMemo(() => [
    { key: 'title', label: 'Activity Title' },
    { key: 'description', label: 'Description', render: (value) => shortDescription(value), className: 'max-w-[320px]' },
    { key: 'instructor_name', label: 'Instructor' },
    { key: 'section_name', label: 'Section' },
    { key: 'due_date', label: 'Due Date', render: (value) => (<div>{formatDate(value)}<div className="text-xs text-slate-400">{value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</div></div>) },
    { key: 'remaining', label: 'Remaining', render: (_v, row) => humanRemaining(row.due_date) },
    { key: 'student_submission_status', label: 'Status', render: (value) => statusBadge(value) },
    { key: 'student_score', label: 'Score', render: (value) => (value != null ? value : '—') },
    { key: 'actions', label: 'Actions', render: (_v, row) => (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleViewActivity(row) }}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowRight size={14} /> View
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleSubmitActivity(row) }}
          className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Submit
        </button>
      </div>
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
          onRowClick={handleViewActivity}
          showActions={false}
          emptyMessage="No activities assigned to your section."
          rowClassName={(row) => {
            const due = row?.due_date ? new Date(row.due_date).getTime() : null
            if (!due) return ''
            const diffHours = (due - Date.now()) / 3600000
            const status = String(row?.student_submission_status || '').toLowerCase()
            if (diffHours < 0 && !status.includes('submitted') && !status.includes('graded')) return 'bg-rose-50'
            if (diffHours <= 24 && diffHours >= 0 && !status.includes('submitted') && !status.includes('graded')) return 'bg-amber-50'
            return ''
          }}
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

      <ActivityDetailInlineModal
        activity={activeActivity}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setActiveActivity(null)
        }}
        onSuccess={handleModalSuccess}
      />
    </div>
  )
}
