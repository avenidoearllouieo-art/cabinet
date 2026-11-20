import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Search, AlertCircle, CheckCircle2, Eye } from 'lucide-react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import StatusBadge from '../../components/StatusBadge'
import DataTable from '../../components/DataTable'
import Pagination from '../../components/Pagination'
import SearchField from '../../components/SearchField.jsx'
import { pluralize } from '../../utils/labels.js'
import { fetchAllResults } from '../../services/paginatedResults.js'
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

function parseValidDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(value, fallback = 'Not recorded') {
  const date = parseValidDate(value)
  return date
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(date)
    : fallback
}

function getManilaDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

function getSubmissionState(activity) {
  const activityStatus = String(activity?.status || '').toLowerCase()
  if (activityStatus === 'closed' || activityStatus === 'archived') return 'closed'

  const status = String(activity?.student_submission_status || '').toLowerCase()
  const hasSubmission = Boolean(activity?.student_submitted_at) && !status.includes('not submitted')
  const dueDate = parseValidDate(activity?.due_date)
  const now = new Date()
  const isPastDue = dueDate && dueDate < now

  if (hasSubmission) {
    if (status.includes('graded')) return 'submitted'
    if (isPastDue) return 'late'
    return 'submitted'
  }

  if (isPastDue) return 'overdue'
  if (dueDate && getManilaDayKey(dueDate) === getManilaDayKey(now)) return 'due_today'
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
  const dueDate = parseValidDate(activity?.due_date)
  const now = new Date()
  const isPastDue = dueDate && dueDate < now
  if (!activity?.student_submitted_at) return !isPastDue || Boolean(activity?.allow_resubmission)
  return !isPastDue || Boolean(activity?.allow_resubmission)
}

function getStudentSection(profile) {
  const rawSection = profile?.section
  return {
    id: typeof rawSection === 'object' ? rawSection.section_id ?? rawSection.id : rawSection ?? profile?.section_id,
    name: profile?.section_name || (typeof rawSection === 'object' ? rawSection.section_name : ''),
  }
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
  const [activeActivity, setActiveActivity] = useState(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false)

  const fetchStats = useCallback(async (sectionId, signal) => {
    try {
      const params = {}
      if (sectionId) params.section = sectionId
      const response = await api.get('/activities/stats/', { params, signal })
      if (signal?.aborted) return
      const data = response.data || {}
      setStats({
        totalActivities: data.totalActivities ?? data.total_activities ?? 0,
        pendingActivities: data.pendingActivities ?? data.pending_activities ?? 0,
        submittedActivities: data.submittedActivities ?? data.submitted_activities ?? 0,
        overdueActivities: data.overdueActivities ?? data.overdue_activities ?? 0,
      })
    } catch (err) {
      if (!signal?.aborted) {
        console.error('Failed to load activity stats:', err)
        setError('Failed to load activity stats.')
      }
    }
  }, [])

  const fetchActivities = useCallback(async (sectionId, signal) => {
    setLoading(true)
    setError(null)
    try {
      const params = { search: query.trim() || undefined }
      if (sectionId) params.section = sectionId
      const { results } = await fetchAllResults(api, '/activities/', params, { signal })
      setActivities(results)
    } catch (err) {
      if (!signal?.aborted) {
        console.error('Failed to load activities:', err)
        setError('Failed to load activities. Please try again.')
        setActivities([])
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    let active = true
    const timeoutId = window.setTimeout(async () => {
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
        if (!active) return
        if (!profile) {
          setError('Failed to load your profile. Please try again.')
          setLoading(false)
          return
        }
        const section = getStudentSection(profile)
        if (!section.id && !section.name) {
          setError('Your account is not assigned to a section. Please contact your instructor.')
          setActivities([])
          setStats({ totalActivities: 0, pendingActivities: 0, submittedActivities: 0, overdueActivities: 0 })
          setLoading(false)
          return
        }
        setStudent(profile)
      } catch (err) {
        if (active) {
          console.error('Failed initializing student activities page:', err)
          setError('Failed to load your activities. Please try again.')
          setLoading(false)
        }
      } finally {
        if (active) setLoading(false)
      }
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    if (!student) return undefined
    const { id: sectionId } = getStudentSection(student)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      void fetchStats(sectionId, controller.signal)
      void fetchActivities(sectionId, controller.signal)
    }, 0)
    return () => { window.clearTimeout(timeoutId); controller.abort() }
  }, [student, fetchActivities, fetchStats])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setPage(1), 0)
    return () => window.clearTimeout(timeoutId)
  }, [query, activeFilter])

  useEffect(() => {
    const handler = () => {
      let profile
      try { profile = JSON.parse(localStorage.getItem('user') || 'null') } catch { profile = null }
      const currentSection = (profile && profile.section) || (student && student.section) || null
      const sectionId = typeof currentSection === 'object' ? currentSection.section_id ?? currentSection.id : currentSection
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

  const handleModalSuccess = () => {
    setIsSubmitModalOpen(false)
    setActiveActivity(null)
    const rawSection = student && student.section
    const sectionId = typeof rawSection === 'object'
      ? rawSection.section_id ?? rawSection.id
      : rawSection || (() => { try { const p = JSON.parse(localStorage.getItem('user') || 'null'); return p && p.section } catch { return null } })()
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
      const leftDueDate = parseValidDate(left.due_date)?.getTime() ?? Number.MAX_SAFE_INTEGER
      const rightDueDate = parseValidDate(right.due_date)?.getTime() ?? Number.MAX_SAFE_INTEGER
      return leftDueDate - rightDueDate
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

  const pageSize = 10
  const pageCount = Math.max(1, Math.ceil(filteredActivities.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleActivities = filteredActivities.slice((currentPage - 1) * pageSize, currentPage * pageSize)

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
    { key: 'due_date', label: 'Due Date', className: 'min-w-[180px]', render: (value) => formatDate(value, 'No deadline') },
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
      <PageHeader title="Activities" description="View your assigned activities, deadlines, and submission progress." />

      <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
        <StatCard icon={<ClipboardList size={18} />} label={`Total ${pluralize(stats.totalActivities, 'Activity', 'Activities')}`} value={stats.totalActivities} subtitle="Activities assigned to your section" />
        <StatCard icon={<Search size={18} />} label={`Pending ${pluralize(stats.pendingActivities, 'Activity', 'Activities')}`} value={stats.pendingActivities} subtitle="Not submitted yet" />
        <StatCard icon={<CheckCircle2 size={18} />} label={`Submitted ${pluralize(stats.submittedActivities, 'Activity', 'Activities')}`} value={stats.submittedActivities} subtitle="Activities you have submitted" />
        <StatCard icon={<AlertCircle size={18} />} label={`Overdue ${pluralize(stats.overdueActivities, 'Activity', 'Activities')}`} value={stats.overdueActivities} subtitle="Past due without submission" />
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <SearchField value={query} onChange={setQuery} onClear={() => setQuery('')} placeholder="Search by title or instructor" ariaLabel="Search activities by title or instructor" className="w-full lg:max-w-md" />
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span>Showing {pluralize(visibleActivities.length, 'activity', 'activities')} of {pluralize(filteredActivities.length, 'activity', 'activities')}</span>
            {(query || activeFilter !== 'all') && <button type="button" onClick={() => { setQuery(''); setActiveFilter('all'); setPage(1) }} className="min-h-9 text-xs font-semibold text-[#1d5b91] hover:underline">Reset Filters</button>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter activities">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => { setActiveFilter(tab.value); setPage(1) }}
              aria-pressed={activeFilter === tab.value}
              className={`min-h-9 rounded-lg px-3 py-2 text-sm font-semibold transition ${activeFilter === tab.value ? 'bg-[#F5B700] text-[#0B1F3A]' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
        <DataTable columns={columns} rows={visibleActivities} loading={loading} variant="instructor" showActions={false} emptyMessage={error ? 'No activities are available.' : 'No activities match these filters.'} />
        {pageCount > 1 && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} label="Showing page" />}
      </section>

      <ActivityViewModal
        activity={activeActivity}
        isOpen={isViewModalOpen}
        onClose={() => { setIsViewModalOpen(false); setActiveActivity(null) }}
      />

      <ActivitySubmitModal activity={activeActivity} isOpen={isSubmitModalOpen} onClose={() => { setIsSubmitModalOpen(false); setActiveActivity(null) }} onSuccess={handleModalSuccess} />
    </div>
  )
}
