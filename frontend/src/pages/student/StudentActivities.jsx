import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Search, AlertCircle, CheckCircle2, Eye } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import StatusBadge from '../../components/StatusBadge'
import DataTable from '../../components/DataTable'
import Pagination from '../../components/Pagination'
import ActivityViewModal from '../../components/student/ActivityViewModal.jsx'
import ActivitySubmitModal from '../../components/student/ActivitySubmitModal.jsx'

const filterTabs = [
  { value: 'all', label: 'All Activities' },
  { value: 'pending', label: 'Pending' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_today', label: 'Due Today' },
  { value: 'closed', label: 'Closed' },
]

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return String(value)
  }
}

function getSubmissionState(activity) {
  const activityStatus = String(activity?.status || '').toLowerCase()
  if (activityStatus === 'closed' || activityStatus === 'archived') return 'closed'

  const status = String(activity?.student_submission_status || '').toLowerCase()
  const hasSubmission = Boolean(activity?.student_submitted_at) && !status.includes('not submitted')
  const dueDate = activity?.due_date ? new Date(activity.due_date) : null
  const now = new Date()
  const isPastDue = dueDate && dueDate < now

  if (hasSubmission) {
    if (status.includes('graded')) return 'submitted'
    if (isPastDue) return 'late'
    return 'submitted'
  }

  if (isPastDue) return 'overdue'
  if (dueDate && dueDate.toDateString() === now.toDateString()) return 'due_today'
  return 'pending'
}

function getBadgeLabel(state) {
  switch (state) {
    case 'submitted':
      return 'Submitted'
    case 'late':
      return 'Late'
    case 'overdue':
      return 'Overdue'
    case 'closed':
      return 'Closed'
    case 'due_today':
      return 'Due Today'
    default:
      return 'Pending'
  }
}

function getActionLabel(state, canEdit) {
  if (state === 'pending' || state === 'due_today' || state === 'overdue') return 'Submit Activity'
  if (state === 'submitted' && canEdit) return 'Edit Submission'
  if (state === 'late' || state === 'closed') return 'View Submission'
  return 'View Submission'
}

function getCanEdit(activity) {
  if (['closed', 'archived'].includes(String(activity?.status || '').toLowerCase())) return false
  const dueDate = activity?.due_date ? new Date(activity.due_date) : null
  const now = new Date()
  const isPastDue = dueDate && dueDate < now
  if (!activity?.student_submitted_at) return !isPastDue || Boolean(activity?.allow_resubmission)
  return !isPastDue || Boolean(activity?.allow_resubmission)
}

export default function StudentActivities() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [student, setStudent] = useState(null)
  const [stats, setStats] = useState({
    totalActivities: 0,
    pendingActivities: 0,
    submittedActivities: 0,
    overdueActivities: 0,
  })
  const [activities, setActivities] = useState([])
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [activeActivity, setActiveActivity] = useState(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false)

  const fetchStats = useCallback(async (sectionId) => {
    try {
      const params = {}
      if (sectionId) params.section = sectionId
      const response = await api.get('/activities/stats/', { params })
      const data = response.data || {}
      setStats({
        totalActivities: data.totalActivities ?? data.total_activities ?? 0,
        pendingActivities: data.pendingActivities ?? data.pending_activities ?? 0,
        submittedActivities: data.submittedActivities ?? data.submitted_activities ?? 0,
        overdueActivities: data.overdueActivities ?? data.overdue_activities ?? 0,
      })
    } catch (err) {
      console.error('Failed to load activity stats:', err)
      setError('Failed to load activity stats.')
    }
  }, [])

  const fetchActivities = useCallback(async (sectionId) => {
    setLoading(true)
    setError(null)
    try {
      const params = { search: query || undefined, page }
      if (sectionId) params.section = sectionId
      const response = await api.get('/activities/', { params })
      const data = response.data || {}
      const fetchedActivities = Array.isArray(data) ? data : Array.isArray(data.results) ? data.results : []
      const count = Number(data.count) || fetchedActivities.length
      const pageSize = Number(data.page_size) || 10
      setPageCount(Math.max(1, Math.ceil(count / pageSize)))
      setActivities(fetchedActivities)
    } catch (err) {
      console.error('Failed to load activities:', err)
      setError('Failed to load activities. Please try again.')
      setActivities([])
    } finally {
      setLoading(false)
    }
  }, [page, query])

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        let profile = null
        try {
          const resp = await api.get('/users/profile/')
          profile = resp.data
          try {
            localStorage.setItem('user', JSON.stringify(profile))
          } catch (storageError) {
            console.warn('Unable to cache the student profile:', storageError)
          }
        } catch {
          try { profile = JSON.parse(localStorage.getItem('user') || 'null') } catch { profile = null }
        }
        setStudent(profile)

        const sectionId = profile && (profile.section || profile.section_id || (profile.section && profile.section.section_id) || null)
        const sectionName = profile && (profile.section_name || (profile.section && profile.section.section_name) || null)
        if (!sectionId && !sectionName) {
          setError('Your account is not assigned to a section. Please contact your instructor.')
          setActivities([])
          setPageCount(0)
          setStats({ totalActivities: 0, pendingActivities: 0, submittedActivities: 0, overdueActivities: 0 })
          setLoading(false)
          return
        }

        await fetchStats(sectionId)
        await fetchActivities(sectionId)
      } catch (err) {
        console.error('Failed initializing student activities page:', err)
        setError('Failed to load your activities. Please try again.')
      } finally {
        setLoading(false)
      }
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchActivities, fetchStats])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setPage(1), 0)
    return () => window.clearTimeout(timeoutId)
  }, [query, activeFilter])

  useEffect(() => {
    const handler = () => {
      let profile
      try { profile = JSON.parse(localStorage.getItem('user') || 'null') } catch { profile = null }
      const sectionId = (profile && profile.section) || (student && student.section) || null
      fetchActivities(sectionId)
      fetchStats(sectionId)
    }
    window.addEventListener('studentSubmissionSaved', handler)
    return () => window.removeEventListener('studentSubmissionSaved', handler)
  }, [student, fetchActivities, fetchStats])

  const handleViewActivity = (activity) => {
    setActiveActivity(activity)
    setIsViewModalOpen(true)
  }

  const handleSubmitActivity = (activity) => {
    setActiveActivity(activity)
    setIsSubmitModalOpen(true)
  }

  const handleSubmitFromDetails = (activity) => {
    setIsViewModalOpen(false)
    setActiveActivity(activity)
    setIsSubmitModalOpen(true)
  }

  const handleModalSuccess = () => {
    setIsSubmitModalOpen(false)
    setActiveActivity(null)
    const sectionId = (student && student.section) || (() => { try { const p = JSON.parse(localStorage.getItem('user') || 'null'); return p && p.section } catch { return null } })()
    fetchActivities(sectionId)
    fetchStats(sectionId)
  }

  const filteredActivities = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    let list = activities.filter((activity) => {
      const matchesQuery = !normalizedQuery || [activity.title, activity.instructor_name, activity.description].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
      return matchesQuery
    })

    const sorted = [...list].sort((left, right) => {
      const leftState = getSubmissionState(left)
      const rightState = getSubmissionState(right)
      const order = { pending: 0, submitted: 1, late: 2, overdue: 3, due_today: 4, closed: 5 }
      const stateDiff = (order[leftState] ?? 99) - (order[rightState] ?? 99)
      if (stateDiff !== 0) return stateDiff

      const leftSubmittedAt = left.student_submitted_at ? new Date(left.student_submitted_at).getTime() : 0
      const rightSubmittedAt = right.student_submitted_at ? new Date(right.student_submitted_at).getTime() : 0
      if (leftState === 'submitted' || leftState === 'late') {
        return rightSubmittedAt - leftSubmittedAt
      }
      return new Date(left.due_date || 0).getTime() - new Date(right.due_date || 0).getTime()
    })

    if (activeFilter === 'all') return sorted

    return sorted.filter((activity) => {
      const state = getSubmissionState(activity)
      if (activeFilter === 'pending') return state === 'pending' || state === 'due_today'
      if (activeFilter === 'submitted') return state === 'submitted' || state === 'late'
      if (activeFilter === 'overdue') return state === 'overdue'
      if (activeFilter === 'due_today') return state === 'due_today'
      if (activeFilter === 'closed') return state === 'closed' || state === 'late'
      return true
    })
  }, [activities, activeFilter, query])

  const columns = [
    { key: 'id', label: 'ID', className: 'min-w-[72px]', render: (value) => value ?? 'Not recorded' },
    {
      key: 'title',
      label: 'Title',
      className: 'min-w-[240px]',
      render: (value, activity) => (
        <div>
          <p className="font-semibold text-[#102a4c]">{value || 'Untitled activity'}</p>
          <p className="text-xs text-slate-500">{activity.activity_type || 'Activity'}</p>
        </div>
      ),
    },
    { key: 'instructor_name', label: 'Instructor', className: 'min-w-[160px]', render: (value) => value || 'Not recorded' },
    { key: 'due_date', label: 'Due Date', className: 'min-w-[180px]', render: (value) => formatDate(value) },
    {
      key: 'student_submission_status',
      label: 'Status',
      className: 'min-w-[125px]',
      render: (_value, activity) => {
        const state = getSubmissionState(activity)
        return <StatusBadge status={state} label={getBadgeLabel(state)} />
      },
    },
    {
      key: 'actions',
      label: 'Action',
      className: 'min-w-[250px]',
      render: (_value, activity) => {
        const state = getSubmissionState(activity)
        const actionLabel = getActionLabel(state, getCanEdit(activity))
        const viewSubmission = actionLabel === 'View Submission'
        return (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => handleViewActivity(activity)} className="student-table-action">
              <Eye size={14} />View Details
            </button>
            <button
              type="button"
              onClick={() => handleSubmitActivity(activity)}
              className={viewSubmission ? 'student-table-action' : 'student-table-action student-table-action-primary'}
            >
              {actionLabel}
            </button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Student Activities" description="Review the activities assigned to your section and manage your submissions." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<ClipboardList size={18} />} label="Total Activities" value={stats.totalActivities} subtitle="Activities assigned to your section" />
        <StatCard icon={<Search size={18} />} label="Pending Activities" value={stats.pendingActivities} subtitle="Not submitted yet" />
        <StatCard icon={<CheckCircle2 size={18} />} label="Submitted Activities" value={stats.submittedActivities} subtitle="Activities you have submitted" />
        <StatCard icon={<AlertCircle size={18} />} label="Overdue Activities" value={stats.overdueActivities} subtitle="Past due without submission" />
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex min-h-11 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-transparent focus-within:ring-2 focus-within:ring-[#0B2A4A] lg:max-w-md">
              <Search size={16} className="shrink-0 text-slate-400" />
              <input
                type="text"
                placeholder="Search by title or instructor"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none"
                aria-label="Search activities by title or instructor"
              />
          </div>
          <div className="text-sm text-slate-500">Showing {filteredActivities.length} of {activities.length} activities</div>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter activities">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveFilter(tab.value)}
              aria-pressed={activeFilter === tab.value}
              className={`min-h-9 rounded-lg px-3 py-2 text-sm font-semibold transition ${activeFilter === tab.value ? 'bg-[#F5B700] text-[#0B1F3A]' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
        <DataTable columns={columns} rows={filteredActivities} loading={loading} variant="instructor" showActions={false} emptyMessage={error ? 'No activities are available.' : 'No activities match these filters.'} />
        {pageCount > 1 && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} label="Showing page" />}
      </section>

      <ActivityViewModal
        activity={activeActivity}
        isOpen={isViewModalOpen}
        submissionAction={activeActivity ? getActionLabel(getSubmissionState(activeActivity), getCanEdit(activeActivity)) : ''}
        onSubmit={handleSubmitFromDetails}
        onClose={() => { setIsViewModalOpen(false); setActiveActivity(null) }}
      />

      <ActivitySubmitModal activity={activeActivity} isOpen={isSubmitModalOpen} onClose={() => { setIsSubmitModalOpen(false); setActiveActivity(null) }} onSuccess={handleModalSuccess} />
    </div>
  )
}
